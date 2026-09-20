// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentTreasury} from "../src/AgentTreasury.sol";
import {MockUSD} from "../src/MockUSD.sol";

contract AgentTreasuryTest is Test {
    AgentTreasury internal treasury;
    MockUSD internal usd;

    address internal human = makeAddr("human");
    address internal oracle = makeAddr("oracle");
    address internal adNetwork = makeAddr("adNetwork");
    address internal agentA = makeAddr("agentA");
    address internal stranger = makeAddr("stranger");
    address internal child = makeAddr("child");

    uint256 internal constant DOLLAR = 1e6;
    uint64 internal constant EPOCH = 1 days;

    uint256 internal campaignId;

    function setUp() public {
        treasury = new AgentTreasury();
        usd = new MockUSD();

        usd.mint(human, 1000 * DOLLAR);
        usd.mint(oracle, 1000 * DOLLAR);

        vm.startPrank(human);
        usd.approve(address(treasury), type(uint256).max);
        campaignId = treasury.openCampaign(address(usd), 100 * DOLLAR, 100 * DOLLAR, EPOCH, oracle);
        treasury.registerAgent(campaignId, agentA, 20 * DOLLAR, 10 * DOLLAR, keccak256("genome-a"));
        vm.stopPrank();

        vm.prank(oracle);
        usd.approve(address(treasury), type(uint256).max);
    }

    // ------------------------------------------------------------ the point

    function test_spend_movesRealTokensAndTracksBudget() public {
        vm.prank(agentA);
        treasury.spend(adNetwork, 3 * DOLLAR, "impressions");

        assertEq(usd.balanceOf(adNetwork), 3 * DOLLAR, "ad network got paid");
        assertEq(_spent(agentA), 3 * DOLLAR);
        assertEq(treasury.spendableNow(agentA), 7 * DOLLAR, "epoch cap is the binding limit");
    }

    function test_spend_revertsPastLifetimeAllowance() public {
        for (uint256 i = 0; i < 2; i++) {
            vm.prank(agentA);
            treasury.spend(adNetwork, 10 * DOLLAR, "impressions");
            skip(EPOCH);
        }

        vm.prank(agentA);
        vm.expectRevert(abi.encodeWithSelector(AgentTreasury.AllowanceExceeded.selector, DOLLAR, 0));
        treasury.spend(adNetwork, DOLLAR, "one more");
    }

    function test_spend_revertsPastEpochCap() public {
        vm.prank(agentA);
        treasury.spend(adNetwork, 8 * DOLLAR, "impressions");

        vm.prank(agentA);
        vm.expectRevert(abi.encodeWithSelector(AgentTreasury.EpochCapExceeded.selector, 5 * DOLLAR, 2 * DOLLAR));
        treasury.spend(adNetwork, 5 * DOLLAR, "too much today");
    }

    function test_epochCapResetsNextEpoch() public {
        vm.prank(agentA);
        treasury.spend(adNetwork, 10 * DOLLAR, "day one");
        assertEq(treasury.spendableNow(agentA), 0, "tapped out for the epoch");

        skip(EPOCH);
        assertEq(treasury.spendableNow(agentA), 10 * DOLLAR, "fresh epoch, lifetime allowance remains");

        vm.prank(agentA);
        treasury.spend(adNetwork, 10 * DOLLAR, "day two");
    }

    function test_spend_revertsPastGlobalCap() public {
        vm.prank(human);
        treasury.setGlobalCap(campaignId, 5 * DOLLAR);

        vm.prank(agentA);
        vm.expectRevert(abi.encodeWithSelector(AgentTreasury.GlobalCapExceeded.selector, 6 * DOLLAR, 5 * DOLLAR));
        treasury.spend(adNetwork, 6 * DOLLAR, "over the campaign ceiling");
    }

    function test_pauseIsAKillSwitchForEveryAgent() public {
        vm.prank(human);
        treasury.setPaused(campaignId, true);

        vm.prank(agentA);
        vm.expectRevert(AgentTreasury.CampaignPaused.selector);
        treasury.spend(adNetwork, DOLLAR, "nope");

        assertEq(treasury.spendableNow(agentA), 0);
    }

    function test_unregisteredWalletCannotSpend() public {
        vm.prank(stranger);
        vm.expectRevert(AgentTreasury.AgentUnknown.selector);
        treasury.spend(adNetwork, DOLLAR, "who am i");
    }

    function test_deadAgentCannotSpend() public {
        vm.prank(human);
        treasury.kill(agentA);

        vm.prank(agentA);
        vm.expectRevert(AgentTreasury.AgentDead.selector);
        treasury.spend(adNetwork, DOLLAR, "ghost");
    }

    // -------------------------------------------------------------- economy

    function test_recordRevenueMovesRealTokensIn() public {
        vm.prank(agentA);
        treasury.spend(adNetwork, 4 * DOLLAR, "ads");

        vm.prank(oracle);
        treasury.recordRevenue(agentA, 12 * DOLLAR, "conv-1");

        assertEq(treasury.profitOf(agentA), int256(8 * DOLLAR));
        assertEq(usd.balanceOf(address(treasury)), 108 * DOLLAR);
    }

    function test_onlyOracleSettlesRevenue() public {
        vm.prank(human);
        vm.expectRevert(AgentTreasury.NotOracle.selector);
        treasury.recordRevenue(agentA, DOLLAR, "forged");
    }

    function test_humanWithdrawsWhatThePopulationDidNotBurn() public {
        vm.prank(agentA);
        treasury.spend(adNetwork, 6 * DOLLAR, "ads");

        vm.prank(human);
        treasury.withdraw(campaignId, human, 94 * DOLLAR);
        assertEq(usd.balanceOf(address(treasury)), 0);

        vm.prank(human);
        vm.expectRevert(AgentTreasury.InsufficientTreasury.selector);
        treasury.withdraw(campaignId, human, DOLLAR);
    }

    // -------------------------------------------------------------- lineage

    function test_reproduceCarvesChildBudgetOutOfTheParent() public {
        vm.prank(agentA);
        treasury.spend(adNetwork, 5 * DOLLAR, "ads");

        vm.prank(human);
        treasury.reproduce(agentA, child, 9 * DOLLAR, 5 * DOLLAR, keccak256("genome-a-mutated"));

        assertEq(_allowance(agentA), 11 * DOLLAR, "parent gave up budget");
        assertEq(_allowance(child), 9 * DOLLAR);
        assertEq(_generation(child), 1);
        assertEq(_parent(child), agentA);
    }

    function test_reproduceCannotMintBudgetFromNothing() public {
        vm.prank(agentA);
        treasury.spend(adNetwork, 10 * DOLLAR, "ads");
        skip(EPOCH);
        vm.prank(agentA);
        treasury.spend(adNetwork, 5 * DOLLAR, "ads");

        vm.prank(human);
        vm.expectRevert(abi.encodeWithSelector(AgentTreasury.AllowanceExceeded.selector, 10 * DOLLAR, 5 * DOLLAR));
        treasury.reproduce(agentA, child, 10 * DOLLAR, 5 * DOLLAR, keccak256("greedy"));
    }

    function test_populationCanNeverOutspendTheGlobalCap() public {
        // Four extra agents with $30 each — $140 of nominal allowance against a $50 ceiling.
        address[4] memory more =
            [makeAddr("d1"), makeAddr("d2"), makeAddr("d3"), makeAddr("d4")];

        vm.startPrank(human);
        for (uint256 i = 0; i < more.length; i++) {
            treasury.registerAgent(campaignId, more[i], 30 * DOLLAR, 30 * DOLLAR, keccak256("g"));
        }
        treasury.setGlobalCap(campaignId, 50 * DOLLAR);
        vm.stopPrank();

        for (uint256 i = 0; i < more.length; i++) {
            uint256 remaining = treasury.spendableNow(more[i]);
            if (remaining == 0) continue;
            vm.prank(more[i]);
            treasury.spend(adNetwork, remaining, "ads");
        }

        assertEq(usd.balanceOf(adNetwork), 50 * DOLLAR, "not one cent over the ceiling");
        vm.prank(agentA);
        vm.expectRevert(abi.encodeWithSelector(AgentTreasury.GlobalCapExceeded.selector, DOLLAR, 0));
        treasury.spend(adNetwork, DOLLAR, "latecomer");
    }

    function test_rosterEnumeratesThePopulation() public {
        vm.prank(human);
        treasury.reproduce(agentA, child, DOLLAR, DOLLAR, keccak256("g"));

        address[] memory list = treasury.roster(campaignId);
        assertEq(list.length, 2);
        assertEq(list[0], agentA);
        assertEq(list[1], child);
    }

    // -------------------------------------------------------------- helpers

    function _allowance(address a) internal view returns (uint256 v) {
        (, v,,,,,,,,,,) = treasury.agents(a);
    }

    function _spent(address a) internal view returns (uint256 v) {
        (,, v,,,,,,,,,) = treasury.agents(a);
    }

    function _generation(address a) internal view returns (uint32 v) {
        (,,,,,,, v,,,,) = treasury.agents(a);
    }

    function _parent(address a) internal view returns (address v) {
        (,,,,,,,, v,,,) = treasury.agents(a);
    }
}
