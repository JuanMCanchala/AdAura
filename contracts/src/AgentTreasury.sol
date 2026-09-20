// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";

/// @title AgentTreasury
/// @notice Custody and hard spending limits for a population of autonomous marketing agents.
///
/// The point of this contract: an agent's budget is not a number in a prompt that a model can
/// talk itself past. It is a state variable, and going over it reverts. The human who funded the
/// campaign keeps a kill switch and can withdraw whatever the population did not burn.
///
/// The full evolutionary tree is recoverable from events alone — AgentRegistered and
/// AgentReproduced carry parent and genome hash, so an indexer never has to trust our database.
contract AgentTreasury {
    // ---------------------------------------------------------------- types

    struct Campaign {
        address owner; // the human; can pause, re-cap and withdraw
        address oracle; // backend signer allowed to settle revenue
        address token; // settlement currency
        uint256 funded; // total deposited
        uint256 spent; // total burned by agents
        uint256 revenue; // total settled back in
        uint256 globalCap; // agents can never burn more than this, in aggregate
        uint64 epochLength; // seconds per spending epoch ("day"); shortened for demos
        bool paused;
        bool exists;
    }

    struct Agent {
        uint256 campaignId;
        uint256 allowance; // lifetime ceiling for this agent
        uint256 spent;
        uint256 revenue;
        uint256 epochCap; // ceiling per epoch
        uint256 spentThisEpoch;
        uint64 epoch; // last epoch touched
        uint32 generation;
        address parent; // address(0) for generation 0
        bytes32 genomeHash; // keccak of the canonical strategy JSON
        bool alive;
        bool exists;
    }

    // --------------------------------------------------------------- errors

    error NotOwner();
    error NotOracle();
    error CampaignUnknown();
    error CampaignPaused();
    error AgentUnknown();
    error AgentDead();
    error AgentExists();
    error AllowanceExceeded(uint256 requested, uint256 remaining);
    error EpochCapExceeded(uint256 requested, uint256 remaining);
    error GlobalCapExceeded(uint256 requested, uint256 remaining);
    error InsufficientTreasury();
    error BadEpochLength();
    error ZeroAddress();

    // --------------------------------------------------------------- events

    event CampaignOpened(
        uint256 indexed campaignId, address indexed owner, address token, uint256 globalCap, uint64 epochLength
    );
    event CampaignFunded(uint256 indexed campaignId, address indexed from, uint256 amount, uint256 totalFunded);
    event CampaignPausedSet(uint256 indexed campaignId, bool paused);
    event GlobalCapSet(uint256 indexed campaignId, uint256 globalCap);
    event Withdrawn(uint256 indexed campaignId, address indexed to, uint256 amount);

    event AgentRegistered(
        uint256 indexed campaignId,
        address indexed agent,
        address indexed parent,
        uint32 generation,
        bytes32 genomeHash,
        uint256 allowance,
        uint256 epochCap
    );
    event AgentReproduced(
        uint256 indexed campaignId, address indexed parent, address indexed child, bytes32 genomeHash, uint256 allowance
    );
    event AgentKilled(uint256 indexed campaignId, address indexed agent, int256 finalProfit, uint256 reclaimed);
    event AllowanceAdjusted(uint256 indexed campaignId, address indexed agent, uint256 allowance, uint256 epochCap);

    event Spent(uint256 indexed campaignId, address indexed agent, address indexed payee, uint256 amount, bytes32 memo);
    event RevenueRecorded(uint256 indexed campaignId, address indexed agent, uint256 amount, bytes32 conversionId);

    // ---------------------------------------------------------------- state

    uint256 public nextCampaignId = 1;
    mapping(uint256 => Campaign) public campaigns;
    mapping(address => Agent) public agents;
    mapping(uint256 => address[]) internal _roster;

    // ------------------------------------------------------------ modifiers

    modifier onlyOwnerOf(uint256 campaignId) {
        Campaign storage c = campaigns[campaignId];
        if (!c.exists) revert CampaignUnknown();
        if (msg.sender != c.owner) revert NotOwner();
        _;
    }

    // ------------------------------------------------------------ campaigns

    /// @notice Open a campaign and deposit its working capital in one call.
    /// @param epochLength seconds per spending epoch. 86400 in production; a demo uses ~60.
    function openCampaign(address token, uint256 amount, uint256 globalCap, uint64 epochLength, address oracle)
        external
        returns (uint256 campaignId)
    {
        if (token == address(0) || oracle == address(0)) revert ZeroAddress();
        if (epochLength == 0) revert BadEpochLength();

        campaignId = nextCampaignId++;
        campaigns[campaignId] = Campaign({
            owner: msg.sender,
            oracle: oracle,
            token: token,
            funded: 0,
            spent: 0,
            revenue: 0,
            globalCap: globalCap,
            epochLength: epochLength,
            paused: false,
            exists: true
        });

        emit CampaignOpened(campaignId, msg.sender, token, globalCap, epochLength);
        if (amount > 0) _pullFunds(campaignId, amount);
    }

    function fund(uint256 campaignId, uint256 amount) external {
        if (!campaigns[campaignId].exists) revert CampaignUnknown();
        _pullFunds(campaignId, amount);
    }

    function _pullFunds(uint256 campaignId, uint256 amount) internal {
        Campaign storage c = campaigns[campaignId];
        IERC20(c.token).transferFrom(msg.sender, address(this), amount);
        c.funded += amount;
        emit CampaignFunded(campaignId, msg.sender, amount, c.funded);
    }

    /// @notice Kill switch for the whole population.
    function setPaused(uint256 campaignId, bool paused) external onlyOwnerOf(campaignId) {
        campaigns[campaignId].paused = paused;
        emit CampaignPausedSet(campaignId, paused);
    }

    function setGlobalCap(uint256 campaignId, uint256 globalCap) external onlyOwnerOf(campaignId) {
        campaigns[campaignId].globalCap = globalCap;
        emit GlobalCapSet(campaignId, globalCap);
    }

    /// @notice Pull unspent capital back out. Only what agents have not burned.
    function withdraw(uint256 campaignId, address to, uint256 amount) external onlyOwnerOf(campaignId) {
        Campaign storage c = campaigns[campaignId];
        uint256 available = c.funded + c.revenue - c.spent;
        if (amount > available) revert InsufficientTreasury();
        c.funded -= amount > c.funded ? c.funded : amount;
        IERC20(c.token).transfer(to, amount);
        emit Withdrawn(campaignId, to, amount);
    }

    // --------------------------------------------------------------- agents

    /// @notice Create a generation-0 agent. Its allowance is carved out of campaign capital.
    function registerAgent(uint256 campaignId, address agent, uint256 allowance, uint256 epochCap, bytes32 genomeHash)
        external
        onlyOwnerOf(campaignId)
    {
        _register(campaignId, agent, address(0), 0, allowance, epochCap, genomeHash);
        emit AgentRegistered(campaignId, agent, address(0), 0, genomeHash, allowance, epochCap);
    }

    /// @notice A profitable agent spawns a mutated child. The child's budget comes out of the
    ///         parent's unspent allowance — never out of thin air, so the global cap still holds.
    function reproduce(address parent, address child, uint256 allowance, uint256 epochCap, bytes32 genomeHash)
        external
    {
        Agent storage p = agents[parent];
        if (!p.exists) revert AgentUnknown();
        if (!p.alive) revert AgentDead();

        uint256 campaignId = p.campaignId;
        Campaign storage c = campaigns[campaignId];
        if (msg.sender != c.owner) revert NotOwner();
        if (c.paused) revert CampaignPaused();

        uint256 remaining = p.allowance - p.spent;
        if (allowance > remaining) revert AllowanceExceeded(allowance, remaining);
        p.allowance -= allowance;

        uint32 gen = p.generation + 1;
        _register(campaignId, child, parent, gen, allowance, epochCap, genomeHash);

        emit AgentRegistered(campaignId, child, parent, gen, genomeHash, allowance, epochCap);
        emit AgentReproduced(campaignId, parent, child, genomeHash, allowance);
    }

    function _register(
        uint256 campaignId,
        address agent,
        address parent,
        uint32 generation,
        uint256 allowance,
        uint256 epochCap,
        bytes32 genomeHash
    ) internal {
        if (agent == address(0)) revert ZeroAddress();
        if (agents[agent].exists) revert AgentExists();

        agents[agent] = Agent({
            campaignId: campaignId,
            allowance: allowance,
            spent: 0,
            revenue: 0,
            epochCap: epochCap,
            spentThisEpoch: 0,
            epoch: _currentEpoch(campaignId),
            generation: generation,
            parent: parent,
            genomeHash: genomeHash,
            alive: true,
            exists: true
        });
        _roster[campaignId].push(agent);
    }

    /// @notice Natural selection, or the human pulling the plug on one agent.
    /// @dev Unspent allowance returns to the campaign implicitly: a dead agent cannot spend.
    function kill(address agent) external {
        Agent storage a = agents[agent];
        if (!a.exists) revert AgentUnknown();
        if (!a.alive) revert AgentDead();
        if (msg.sender != campaigns[a.campaignId].owner) revert NotOwner();

        a.alive = false;
        uint256 reclaimed = a.allowance - a.spent;
        int256 profit = int256(a.revenue) - int256(a.spent);
        emit AgentKilled(a.campaignId, agent, profit, reclaimed);
    }

    function adjustAllowance(address agent, uint256 allowance, uint256 epochCap) external {
        Agent storage a = agents[agent];
        if (!a.exists) revert AgentUnknown();
        if (msg.sender != campaigns[a.campaignId].owner) revert NotOwner();
        if (allowance < a.spent) revert AllowanceExceeded(a.spent, allowance);

        a.allowance = allowance;
        a.epochCap = epochCap;
        emit AllowanceAdjusted(a.campaignId, agent, allowance, epochCap);
    }

    // -------------------------------------------------------------- economy

    /// @notice Called by the agent itself, with its own wallet, to pay for a service.
    ///         Every limit in the system is checked right here.
    function spend(address payee, uint256 amount, bytes32 memo) external {
        Agent storage a = agents[msg.sender];
        if (!a.exists) revert AgentUnknown();
        if (!a.alive) revert AgentDead();

        Campaign storage c = campaigns[a.campaignId];
        if (c.paused) revert CampaignPaused();

        uint256 agentRemaining = a.allowance - a.spent;
        if (amount > agentRemaining) revert AllowanceExceeded(amount, agentRemaining);

        uint64 epoch = _currentEpoch(a.campaignId);
        if (epoch != a.epoch) {
            a.epoch = epoch;
            a.spentThisEpoch = 0;
        }
        uint256 epochRemaining = a.epochCap - a.spentThisEpoch;
        if (amount > epochRemaining) revert EpochCapExceeded(amount, epochRemaining);

        uint256 globalRemaining = c.globalCap - c.spent;
        if (amount > globalRemaining) revert GlobalCapExceeded(amount, globalRemaining);

        uint256 liquid = c.funded + c.revenue - c.spent;
        if (amount > liquid) revert InsufficientTreasury();

        a.spent += amount;
        a.spentThisEpoch += amount;
        c.spent += amount;

        IERC20(c.token).transfer(payee, amount);
        emit Spent(a.campaignId, msg.sender, payee, amount, memo);
    }

    /// @notice Settle a conversion. The oracle moves the real tokens in, so revenue on this
    ///         contract is money that actually arrived, not a self-reported metric.
    function recordRevenue(address agent, uint256 amount, bytes32 conversionId) external {
        Agent storage a = agents[agent];
        if (!a.exists) revert AgentUnknown();

        Campaign storage c = campaigns[a.campaignId];
        if (msg.sender != c.oracle) revert NotOracle();

        IERC20(c.token).transferFrom(msg.sender, address(this), amount);
        a.revenue += amount;
        c.revenue += amount;

        emit RevenueRecorded(a.campaignId, agent, amount, conversionId);
    }

    // ----------------------------------------------------------------- read

    function roster(uint256 campaignId) external view returns (address[] memory) {
        return _roster[campaignId];
    }

    function rosterSize(uint256 campaignId) external view returns (uint256) {
        return _roster[campaignId].length;
    }

    /// @notice Signed profit of an agent, the default fitness function.
    function profitOf(address agent) external view returns (int256) {
        Agent storage a = agents[agent];
        if (!a.exists) revert AgentUnknown();
        return int256(a.revenue) - int256(a.spent);
    }

    /// @notice What this agent may still spend right now, taking every ceiling into account.
    function spendableNow(address agent) external view returns (uint256) {
        Agent storage a = agents[agent];
        if (!a.exists || !a.alive) return 0;

        Campaign storage c = campaigns[a.campaignId];
        if (c.paused) return 0;

        uint256 limit = a.allowance - a.spent;
        uint256 epochUsed = _currentEpoch(a.campaignId) == a.epoch ? a.spentThisEpoch : 0;
        uint256 epochRemaining = a.epochCap - epochUsed;
        if (epochRemaining < limit) limit = epochRemaining;

        uint256 globalRemaining = c.globalCap - c.spent;
        if (globalRemaining < limit) limit = globalRemaining;

        uint256 liquid = c.funded + c.revenue - c.spent;
        if (liquid < limit) limit = liquid;

        return limit;
    }

    function _currentEpoch(uint256 campaignId) internal view returns (uint64) {
        return uint64(block.timestamp / campaigns[campaignId].epochLength);
    }
}
