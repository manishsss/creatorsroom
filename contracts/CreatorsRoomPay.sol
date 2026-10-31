// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title  CreatorsRoomPay
 * @notice USDC escrow for brand-to-creator campaigns.
 *
 * State machine:
 *   Pending  → Active (fundCampaign)
 *   Active   → Approved (approveCampaign, before approvalDeadline)
 *   Active   → Refunded (refundBrand, after approvalDeadline)
 *
 * Scheduled Unlock:
 *   Brands may set a `claimUnlockTime` when creating a campaign.
 *   If non-zero, `claimPayment` reverts with `ClaimNotYetUnlocked` until
 *   `block.timestamp >= claimUnlockTime`.  The brand's approval transaction
 *   is still required before any unlock; the timer merely adds a further
 *   delay after approval.  Setting `claimUnlockTime = 0` (or omitting it)
 *   means creators can claim immediately after approval.
 *
 * USDC-blocklisted recipients:
 *   If a creator wallet is blocklisted by Circle after an approved campaign
 *   is locked, that creator's payment may become unclaimable.
 *   Mitigation: brands should verify creator addresses before funding, and
 *   can use replaceCreator() to correct addresses while status is Pending.
 */
contract CreatorsRoomPay {
    enum Status {
        Pending,
        Active,
        Approved,
        Refunded
    }

    struct Creator {
        address wallet;
        uint256 amount;
        string deliverable;
        bool claimed;
    }

    struct Campaign {
        address brand;
        string title;
        string description;
        uint64 fundDeadline;
        uint64 approvalDeadline;
        /// @dev 0 = no unlock delay; creators can claim immediately after approval.
        ///      Non-zero = block.timestamp must be >= this value for claimPayment to succeed.
        ///      Frozen at fundCampaign; cannot be changed afterward.
        uint64 claimUnlockTime;
        Status status;
        uint256 totalBudget;
        Creator[] creators;
    }

    // ── Errors ─────────────────────────────────────────────────────────
    error ZeroAddressUSDC();
    error CampaignNotFound(uint256 campaignId);
    error EmptyTitle();
    error InvalidFundDeadline(uint64 fundDeadline, uint256 currentTime);
    error InvalidApprovalDeadline(uint64 approvalDeadline, uint64 fundDeadline);
    /// @dev claimUnlockTime must be 0 (no delay) or > approvalDeadline.
    ///      Requiring it to be > approvalDeadline prevents a value that is
    ///      already in the past by the time approval could happen.
    error InvalidClaimUnlockTime(uint64 claimUnlockTime, uint64 approvalDeadline);
    error ClaimNotYetUnlocked(uint64 claimUnlockTime, uint256 currentTime);
    error InvalidCreatorCount(uint256 count);
    error CreatorAmountLengthMismatch(uint256 walletsLength, uint256 amountsLength);
    error ZeroCreatorAddress(uint256 index);
    error ZeroCreatorAmount(uint256 index);
    error InvalidCampaignStatus(Status expected, Status actual);
    error OnlyBrand(address caller, address brand);
    error FundDeadlinePassed(uint64 fundDeadline, uint256 currentTime);
    error ApprovalDeadlinePassed(uint64 approvalDeadline, uint256 currentTime);
    error ApprovalDeadlineNotPassed(uint64 approvalDeadline, uint256 currentTime);
    error ZeroTotalBudget();
    error TransferFromFailed(address from, address to, uint256 amount);
    error TransferFailed(address to, uint256 amount);
    error InvalidCreatorIndex(uint256 index, uint256 creatorCount);
    error OnlyCreator(address caller, address creatorWallet);
    error EmptyDeliverableLink();
    error AlreadyClaimed(uint256 campaignId, uint256 creatorIndex);
    /// @dev approveAndPayAll requires claimUnlockTime == 0.
    ///      Scheduled-unlock campaigns must use approveCampaign() + claimPayment().
    error ScheduledUnlockCampaign(uint256 campaignId, uint64 claimUnlockTime);

    // ── Events ─────────────────────────────────────────────────────────
    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed brand,
        uint256 totalBudget,
        uint64 claimUnlockTime
    );
    event CampaignFunded(uint256 indexed campaignId, uint256 totalBudget);
    event DeliverableSubmitted(
        uint256 indexed campaignId,
        uint256 indexed creatorIndex,
        address indexed creator,
        string link
    );
    event CampaignApproved(uint256 indexed campaignId);
    event PaymentClaimed(
        uint256 indexed campaignId,
        uint256 indexed creatorIndex,
        address indexed creator,
        uint256 amount
    );
    event BrandRefunded(uint256 indexed campaignId, address indexed brand, uint256 amount);
    event CreatorReplaced(uint256 indexed campaignId, uint256 indexed creatorIndex, address indexed newWallet);

    // ── State ──────────────────────────────────────────────────────────
    mapping(uint256 => Campaign) public campaigns;
    uint256 public campaignCount;
    address public immutable usdc;

    constructor(address _usdc) {
        if (_usdc == address(0)) revert ZeroAddressUSDC();
        usdc = _usdc;
    }

    // ── Write functions ────────────────────────────────────────────────

    /**
     * @notice Create a new campaign.
     * @param title             Human-readable campaign name.
     * @param description       Optional description / deliverable brief.
     * @param fundDeadline      Brand must fund before this unix timestamp.
     * @param approvalDeadline  Brand must approve before this unix timestamp (> fundDeadline).
     * @param claimUnlockTime   Earliest unix timestamp at which creators may claim after approval.
     *                          Pass 0 for no delay (creators claim immediately after approval).
     *                          If non-zero, must be strictly greater than approvalDeadline.
     * @param creatorWallets    Recipient addresses (max 20).
     * @param amounts           USDC amounts in 6-decimal units, parallel to creatorWallets.
     */
    function createCampaign(
        string calldata title,
        string calldata description,
        uint64 fundDeadline,
        uint64 approvalDeadline,
        uint64 claimUnlockTime,
        address[] calldata creatorWallets,
        uint256[] calldata amounts
    ) external returns (uint256 campaignId) {
        if (bytes(title).length == 0) revert EmptyTitle();
        if (fundDeadline <= block.timestamp) revert InvalidFundDeadline(fundDeadline, block.timestamp);
        if (approvalDeadline <= fundDeadline) revert InvalidApprovalDeadline(approvalDeadline, fundDeadline);
        // claimUnlockTime == 0 means "no scheduled unlock" (immediate after approval).
        // If set, it must be strictly after approvalDeadline so it isn't trivially bypassed.
        if (claimUnlockTime != 0 && claimUnlockTime <= approvalDeadline) {
            revert InvalidClaimUnlockTime(claimUnlockTime, approvalDeadline);
        }

        uint256 creatorCount = creatorWallets.length;
        if (creatorCount == 0 || creatorCount > 20) revert InvalidCreatorCount(creatorCount);
        if (creatorCount != amounts.length) {
            revert CreatorAmountLengthMismatch(creatorCount, amounts.length);
        }

        uint256 totalBudget;
        for (uint256 i = 0; i < creatorCount; ++i) {
            address creatorWallet = creatorWallets[i];
            uint256 amount = amounts[i];

            if (creatorWallet == address(0)) revert ZeroCreatorAddress(i);
            if (amount == 0) revert ZeroCreatorAmount(i);

            totalBudget += amount;
        }

        campaignId = campaignCount;
        campaignCount = campaignId + 1;

        Campaign storage campaign = campaigns[campaignId];
        campaign.brand = msg.sender;
        campaign.title = title;
        campaign.description = description;
        campaign.fundDeadline = fundDeadline;
        campaign.approvalDeadline = approvalDeadline;
        campaign.claimUnlockTime = claimUnlockTime;
        campaign.status = Status.Pending;
        campaign.totalBudget = totalBudget;

        for (uint256 i = 0; i < creatorCount; ++i) {
            campaign.creators.push(
                Creator({
                    wallet: creatorWallets[i],
                    amount: amounts[i],
                    deliverable: "",
                    claimed: false
                })
            );
        }

        emit CampaignCreated(campaignId, msg.sender, totalBudget, claimUnlockTime);
    }

    function fundCampaign(uint256 campaignId) external {
        _requireCampaignExists(campaignId);
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.status != Status.Pending) revert InvalidCampaignStatus(Status.Pending, campaign.status);
        if (msg.sender != campaign.brand) revert OnlyBrand(msg.sender, campaign.brand);
        if (block.timestamp > campaign.fundDeadline) {
            revert FundDeadlinePassed(campaign.fundDeadline, block.timestamp);
        }
        if (campaign.totalBudget == 0) revert ZeroTotalBudget();

        campaign.status = Status.Active;

        // Balance-before/after check guards against fee-on-transfer or deflationary
        // token semantics that would credit less than campaign.totalBudget.
        // USDC on Arc/Ethereum is non-deflationary, but this makes the guarantee
        // explicit and eliminates cross-campaign solvency risk from any misconfigured token.
        uint256 balanceBefore = IERC20(usdc).balanceOf(address(this));
        bool success = IERC20(usdc).transferFrom(msg.sender, address(this), campaign.totalBudget);
        if (!success) revert TransferFromFailed(msg.sender, address(this), campaign.totalBudget);
        uint256 received = IERC20(usdc).balanceOf(address(this)) - balanceBefore;
        if (received != campaign.totalBudget) {
            revert TransferFromFailed(msg.sender, address(this), campaign.totalBudget);
        }

        emit CampaignFunded(campaignId, campaign.totalBudget);
    }

    /**
     * @notice Replace a creator wallet before the campaign is funded.
     * @dev Only callable by the brand while status is Pending.
     *      Once funded (Active), all recipients are frozen.
     */
    function replaceCreator(
        uint256 campaignId,
        uint256 creatorIndex,
        address newWallet
    ) external {
        _requireCampaignExists(campaignId);
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != Status.Pending) revert InvalidCampaignStatus(Status.Pending, campaign.status);
        if (msg.sender != campaign.brand) revert OnlyBrand(msg.sender, campaign.brand);
        if (creatorIndex >= campaign.creators.length) revert InvalidCreatorIndex(creatorIndex, campaign.creators.length);
        if (newWallet == address(0)) revert ZeroCreatorAddress(creatorIndex);
        campaign.creators[creatorIndex].wallet = newWallet;
        emit CreatorReplaced(campaignId, creatorIndex, newWallet);
    }

    function submitDeliverable(uint256 campaignId, uint256 creatorIndex, string calldata link) external {
        _requireCampaignExists(campaignId);
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.status != Status.Active) revert InvalidCampaignStatus(Status.Active, campaign.status);
        if (creatorIndex >= campaign.creators.length) {
            revert InvalidCreatorIndex(creatorIndex, campaign.creators.length);
        }

        Creator storage creator = campaign.creators[creatorIndex];

        if (msg.sender != creator.wallet) revert OnlyCreator(msg.sender, creator.wallet);
        if (bytes(link).length == 0) revert EmptyDeliverableLink();

        creator.deliverable = link;

        emit DeliverableSubmitted(campaignId, creatorIndex, msg.sender, link);
    }

    function approveCampaign(uint256 campaignId) external {
        _requireCampaignExists(campaignId);
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.status != Status.Active) revert InvalidCampaignStatus(Status.Active, campaign.status);
        if (msg.sender != campaign.brand) revert OnlyBrand(msg.sender, campaign.brand);
        // Strict-before: approval at exactly approvalDeadline is disallowed,
        // since at that timestamp refundBrand also becomes callable.
        // Using >= avoids the ambiguous boundary and matches the product rule
        // that approval must occur BEFORE (not at) the deadline.
        if (block.timestamp >= campaign.approvalDeadline) {
            revert ApprovalDeadlinePassed(campaign.approvalDeadline, block.timestamp);
        }

        campaign.status = Status.Approved;

        emit CampaignApproved(campaignId);
    }

    /**
     * @notice Approve a campaign AND immediately push every creator's allocation
     *         to their registered wallet in the same transaction.
     *
     * @dev    Only callable when claimUnlockTime == 0 (immediate-payment campaigns).
     *         For scheduled-unlock campaigns the brand must use approveCampaign()
     *         and creators claim via claimPayment() after the unlock time.
     *
     *         CEI: status and claimed flags are set before all external calls.
     *         If any single transfer fails the entire transaction reverts, preserving
     *         the accounting invariant that no creator is marked paid without receipt.
     *
     *         Duplicate-payment prevention: each creator's `claimed` flag is set to
     *         true atomically within this function; a second call is blocked by the
     *         `InvalidCampaignStatus` guard (status is already Approved, not Active).
     */
    function approveAndPayAll(uint256 campaignId) external {
        _requireCampaignExists(campaignId);
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.status != Status.Active) revert InvalidCampaignStatus(Status.Active, campaign.status);
        if (msg.sender != campaign.brand) revert OnlyBrand(msg.sender, campaign.brand);
        if (block.timestamp >= campaign.approvalDeadline) {
            revert ApprovalDeadlinePassed(campaign.approvalDeadline, block.timestamp);
        }
        // This function is only for immediate-payment campaigns.
        // Campaigns with a scheduled unlock must use approveCampaign() + claimPayment().
        if (campaign.claimUnlockTime != 0) revert ScheduledUnlockCampaign(campaignId, campaign.claimUnlockTime);

        // ── CEI: update all state before any external transfer ─────────
        campaign.status = Status.Approved;
        uint256 creatorCount = campaign.creators.length;
        for (uint256 i = 0; i < creatorCount; ++i) {
            campaign.creators[i].claimed = true;
        }

        emit CampaignApproved(campaignId);

        // ── External calls: push funds to each creator ─────────────────
        for (uint256 i = 0; i < creatorCount; ++i) {
            address wallet = campaign.creators[i].wallet;
            uint256 amount = campaign.creators[i].amount;
            bool success = IERC20(usdc).transfer(wallet, amount);
            if (!success) revert TransferFailed(wallet, amount);
            emit PaymentClaimed(campaignId, i, wallet, amount);
        }
    }

    /**
     * @notice Claim a creator's USDC allocation.
     * @dev    Reverts with ClaimNotYetUnlocked if the campaign has a scheduled
     *         unlock time that has not yet been reached.
     */
    function claimPayment(uint256 campaignId, uint256 creatorIndex) external {
        _requireCampaignExists(campaignId);
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.status != Status.Approved) revert InvalidCampaignStatus(Status.Approved, campaign.status);
        if (creatorIndex >= campaign.creators.length) {
            revert InvalidCreatorIndex(creatorIndex, campaign.creators.length);
        }

        // Scheduled unlock: enforce on-chain regardless of frontend state.
        uint64 unlockTime = campaign.claimUnlockTime;
        if (unlockTime != 0 && block.timestamp < unlockTime) {
            revert ClaimNotYetUnlocked(unlockTime, block.timestamp);
        }

        Creator storage creator = campaign.creators[creatorIndex];

        if (msg.sender != creator.wallet) revert OnlyCreator(msg.sender, creator.wallet);
        if (creator.claimed) revert AlreadyClaimed(campaignId, creatorIndex);

        uint256 amount = creator.amount;
        creator.claimed = true;

        bool success = IERC20(usdc).transfer(msg.sender, amount);
        if (!success) revert TransferFailed(msg.sender, amount);

        emit PaymentClaimed(campaignId, creatorIndex, msg.sender, amount);
    }

    function refundBrand(uint256 campaignId) external {
        _requireCampaignExists(campaignId);
        Campaign storage campaign = campaigns[campaignId];

        if (campaign.status != Status.Active) revert InvalidCampaignStatus(Status.Active, campaign.status);
        if (msg.sender != campaign.brand) revert OnlyBrand(msg.sender, campaign.brand);
        if (block.timestamp <= campaign.approvalDeadline) {
            revert ApprovalDeadlineNotPassed(campaign.approvalDeadline, block.timestamp);
        }

        uint256 amount = campaign.totalBudget;
        campaign.status = Status.Refunded;

        bool success = IERC20(usdc).transfer(campaign.brand, amount);
        if (!success) revert TransferFailed(campaign.brand, amount);

        emit BrandRefunded(campaignId, campaign.brand, amount);
    }

    // ── View helpers ───────────────────────────────────────────────────

    function getCreator(
        uint256 campaignId,
        uint256 index
    ) external view returns (address wallet, uint256 amount, string memory deliverable, bool claimed) {
        _requireCampaignExists(campaignId);
        Campaign storage campaign = campaigns[campaignId];

        if (index >= campaign.creators.length) revert InvalidCreatorIndex(index, campaign.creators.length);

        Creator storage creator = campaign.creators[index];
        return (creator.wallet, creator.amount, creator.deliverable, creator.claimed);
    }

    function getCreatorCount(uint256 campaignId) external view returns (uint256) {
        _requireCampaignExists(campaignId);
        return campaigns[campaignId].creators.length;
    }

    function getCampaignStatus(uint256 campaignId) external view returns (Status) {
        _requireCampaignExists(campaignId);
        return campaigns[campaignId].status;
    }

    // ── Internal ───────────────────────────────────────────────────────
    function _requireCampaignExists(uint256 campaignId) internal view {
        if (campaignId >= campaignCount) revert CampaignNotFound(campaignId);
    }
}
