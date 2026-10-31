// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {CreatorsRoomPay} from "../CreatorsRoomPay.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Foundry unit + security tests for CreatorsRoomPay.
 *
 * Groups:
 *   A) Campaign creation (incl. claimUnlockTime)
 *   B) Funding (incl. fee-on-transfer revert, cross-campaign solvency)
 *   C) Deliverable submission
 *   D) Approval (incl. strict-before deadline, double-approve)
 *   E) Claim (incl. scheduled-unlock, double-claim, wrong caller, cross-campaign)
 *   F) Refund (incl. double-refund, wrong caller, after-approval)
 *   G) replaceCreator (incl. after-fund, zero address, wrong caller)
 *   H) Scheduled Unlock — dedicated block
 *   I) Reentrancy — malicious ERC-20 that re-enters on transfer
 *   J) Transfer-fail atomicity — failed transfer must not mark state as complete
 *   K) Cross-campaign isolation — balance and index isolation
 *   L) Invariant checks — budget conservation, no admin drain path
 *   M) Edge inputs — duplicate recipients, 1 wei, max creators, zero amounts
 */

// ── Mock USDC (standard) ────────────────────────────────────────────────
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    string public constant symbol   = "USDC";
    uint8  public constant decimals = 6;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

// ── Mock: always returns true but transfers 1 less (fee-on-transfer) ─────
contract FeeOnTransferUSDC is MockUSDC {
    // transferFrom takes the fee from the amount received by the contract
    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        // Deliver 1 less (simulate a 1-unit fee)
        balanceOf[to] += amount - 1;
        return true;
    }
}

// ── Mock: returns false on transfer (not revert) ──────────────────────
contract ReturnFalseUSDC is MockUSDC {
    bool public failTransfer;
    bool public failTransferFrom;

    function setFailTransfer(bool v) external { failTransfer = v; }
    function setFailTransferFrom(bool v) external { failTransferFrom = v; }

    function transfer(address to, uint256 amount) external override returns (bool) {
        if (failTransfer) return false;
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        if (failTransferFrom) return false;
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

// ── Reentrancy attacker: re-enters claimPayment on receiving tokens ───────
contract ReentrancyAttacker {
    CreatorsRoomPay private target;
    uint256 private campaignId;
    uint256 private creatorIndex;
    uint256 private reentrancyDepth;

    function setup(address _target, uint256 _campaignId, uint256 _creatorIndex) external {
        target      = CreatorsRoomPay(_target);
        campaignId  = _campaignId;
        creatorIndex = _creatorIndex;
    }

    // ERC-20 transfer calls this (simulate transfer-with-callback)
    receive() external payable {}

    // Called by a malicious token's transfer hook to re-enter
    function onTokenTransfer(address, uint256, bytes calldata) external returns (bool) {
        _reenter();
        return true;
    }

    function claim() external {
        target.claimPayment(campaignId, creatorIndex);
    }

    function _reenter() internal {
        if (reentrancyDepth < 1) {
            reentrancyDepth++;
            try target.claimPayment(campaignId, creatorIndex) {} catch {}
            reentrancyDepth--;
        }
    }
}

// ── Mock: calls back into claimPayment on transfer (reentrancy vector) ───
contract ReentrantUSDC is MockUSDC {
    ReentrancyAttacker public attacker;

    function setAttacker(address a) external { attacker = ReentrancyAttacker(payable(a)); }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        // Hook: if recipient is the attacker, attempt re-entry
        if (to == address(attacker)) {
            try attacker.claim() {} catch {}
        }
        return true;
    }
}


// ── Base test contract ─────────────────────────────────────────────────
contract CreatorsRoomPayBase is Test {
    CreatorsRoomPay internal crp;
    MockUSDC        internal usdc;

    address internal brand    = makeAddr("brand");
    address internal creator1 = makeAddr("creator1");
    address internal creator2 = makeAddr("creator2");

    uint64 internal fundDeadline;
    uint64 internal approvalDeadline;

    uint256 internal constant AMT1  = 500e6; // 500 USDC
    uint256 internal constant AMT2  = 300e6; // 300 USDC
    uint256 internal constant TOTAL = AMT1 + AMT2;

    function setUp() public virtual {
        usdc = new MockUSDC();
        crp  = new CreatorsRoomPay(address(usdc));

        vm.warp(1);
        fundDeadline     = uint64(block.timestamp + 1 days);
        approvalDeadline = uint64(block.timestamp + 7 days);

        usdc.mint(brand, 10_000e6);
    }

    // ── Helpers ───────────────────────────────────────────────────────
    function _defaultWallets() internal view returns (address[] memory w) {
        w = new address[](2);
        w[0] = creator1;
        w[1] = creator2;
    }

    function _defaultAmounts() internal pure returns (uint256[] memory a) {
        a = new uint256[](2);
        a[0] = AMT1;
        a[1] = AMT2;
    }

    function _createCampaign(uint64 unlockTime) internal returns (uint256 id) {
        vm.prank(brand);
        id = crp.createCampaign(
            "Test Campaign", "Description",
            fundDeadline, approvalDeadline, unlockTime,
            _defaultWallets(), _defaultAmounts()
        );
    }

    function _fundCampaign(uint256 id) internal {
        vm.startPrank(brand);
        usdc.approve(address(crp), TOTAL);
        crp.fundCampaign(id);
        vm.stopPrank();
    }

    function _approveCampaign(uint256 id) internal {
        vm.prank(brand);
        crp.approveCampaign(id);
    }

    // ── Field readers (avoid stack-too-deep on 8-field tuple) ─────────
    function _campaignBrand(uint256 id)  internal view returns (address b)      { (b,,,,,,,) = crp.campaigns(id); }
    function _campaignTitle(uint256 id)  internal view returns (string memory t) { (,t,,,,,,) = crp.campaigns(id); }
    function _campaignFd(uint256 id)     internal view returns (uint64 fd)       { (,,,fd,,,,) = crp.campaigns(id); }
    function _campaignAd(uint256 id)     internal view returns (uint64 ad)       { (,,,,ad,,,) = crp.campaigns(id); }
    function _campaignCut(uint256 id)    internal view returns (uint64 cut)      { (,,,,,cut,,) = crp.campaigns(id); }
    function _campaignStatus(uint256 id) internal view returns (uint8 s)         { CreatorsRoomPay.Status st; (,,,,,,st,) = crp.campaigns(id); s = uint8(st); }
    function _campaignBudget(uint256 id) internal view returns (uint256 bud)     { (,,,,,,,bud) = crp.campaigns(id); }
}

// ════════════════════════════════════════════════════════════════════════
// A) createCampaign
// ════════════════════════════════════════════════════════════════════════
contract TestCreate is CreatorsRoomPayBase {
    function _getCampaign(uint256 id) internal view returns (
        address b, string memory ttl, string memory,
        uint64 fd, uint64 ad, uint64 cut, uint8 status, uint256 budget
    ) {
        b      = _campaignBrand(id);
        ttl    = _campaignTitle(id);
        fd     = _campaignFd(id);
        ad     = _campaignAd(id);
        cut    = _campaignCut(id);
        status = _campaignStatus(id);
        budget = _campaignBudget(id);
    }

    function test_createCampaign_success_noUnlock() public {
        uint256 id = _createCampaign(0);
        assertEq(id, 0);
        assertEq(crp.campaignCount(), 1);
        (address b, string memory ttl,, uint64 fd, uint64 ad, uint64 cut, uint8 s, uint256 bud) = _getCampaign(id);
        assertEq(b, brand);
        assertEq(ttl, "Test Campaign");
        assertEq(fd, fundDeadline);
        assertEq(ad, approvalDeadline);
        assertEq(cut, 0, "no unlock");
        assertEq(s, 0, "Pending");
        assertEq(bud, TOTAL);
    }

    function test_createCampaign_success_withUnlock() public {
        uint64 unlock = approvalDeadline + 3 days;
        uint256 id = _createCampaign(unlock);
        assertEq(_campaignCut(id), unlock);
    }

    function test_createCampaign_revert_emptyTitle() public {
        vm.prank(brand);
        vm.expectRevert(CreatorsRoomPay.EmptyTitle.selector);
        crp.createCampaign("", "", fundDeadline, approvalDeadline, 0, _defaultWallets(), _defaultAmounts());
    }

    function test_createCampaign_revert_invalidFundDeadline() public {
        vm.prank(brand);
        vm.expectRevert();
        crp.createCampaign("T", "", uint64(block.timestamp - 1), approvalDeadline, 0, _defaultWallets(), _defaultAmounts());
    }

    function test_createCampaign_revert_fundDeadlineEqualNow() public {
        vm.prank(brand);
        vm.expectRevert();
        crp.createCampaign("T", "", uint64(block.timestamp), approvalDeadline, 0, _defaultWallets(), _defaultAmounts());
    }

    function test_createCampaign_revert_invalidApprovalDeadline() public {
        vm.prank(brand);
        vm.expectRevert();
        crp.createCampaign("T", "", fundDeadline, fundDeadline, 0, _defaultWallets(), _defaultAmounts());
    }

    function test_createCampaign_revert_invalidClaimUnlockTime_beforeApproval() public {
        vm.prank(brand);
        vm.expectRevert();
        crp.createCampaign("T", "", fundDeadline, approvalDeadline, approvalDeadline, _defaultWallets(), _defaultAmounts());
    }

    function test_createCampaign_revert_claimUnlockEqualApprovalDeadline() public {
        vm.prank(brand);
        vm.expectRevert(
            abi.encodeWithSelector(CreatorsRoomPay.InvalidClaimUnlockTime.selector, approvalDeadline, approvalDeadline)
        );
        crp.createCampaign("T", "", fundDeadline, approvalDeadline, approvalDeadline, _defaultWallets(), _defaultAmounts());
    }

    function test_createCampaign_revert_tooManyCreators() public {
        address[] memory w = new address[](21);
        uint256[] memory a = new uint256[](21);
        for (uint256 i = 0; i < 21; i++) { w[i] = address(uint160(i + 100)); a[i] = 1e6; }
        vm.prank(brand);
        vm.expectRevert();
        crp.createCampaign("T", "", fundDeadline, approvalDeadline, 0, w, a);
    }

    function test_createCampaign_revert_zeroCreatorAddress() public {
        address[] memory w = new address[](1);
        uint256[] memory a = new uint256[](1);
        w[0] = address(0);
        a[0] = 1e6;
        vm.prank(brand);
        vm.expectRevert();
        crp.createCampaign("T", "", fundDeadline, approvalDeadline, 0, w, a);
    }

    function test_createCampaign_revert_zeroAmount() public {
        address[] memory w = new address[](1);
        uint256[] memory a = new uint256[](1);
        w[0] = creator1;
        a[0] = 0;
        vm.prank(brand);
        vm.expectRevert();
        crp.createCampaign("T", "", fundDeadline, approvalDeadline, 0, w, a);
    }

    function test_createCampaign_1Wei_amount() public {
        address[] memory w = new address[](1);
        uint256[] memory a = new uint256[](1);
        w[0] = creator1;
        a[0] = 1; // 1 micro-USDC
        vm.prank(brand);
        uint256 id = crp.createCampaign("T", "", fundDeadline, approvalDeadline, 0, w, a);
        assertEq(_campaignBudget(id), 1);
    }

    /// Duplicate recipient addresses: currently allowed by the contract.
    /// Documenting the design decision — two entries for the same wallet each claim separately.
    function test_createCampaign_duplicateRecipients_allowed() public {
        address[] memory w = new address[](2);
        uint256[] memory a = new uint256[](2);
        w[0] = creator1;
        w[1] = creator1; // same wallet twice
        a[0] = AMT1;
        a[1] = AMT2;
        vm.prank(brand);
        uint256 id = crp.createCampaign("T", "", fundDeadline, approvalDeadline, 0, w, a);
        // Both entries must be claimable independently via their respective indices
        _fundCampaign(id);
        _approveCampaign(id);
        vm.prank(creator1);
        crp.claimPayment(id, 0);
        vm.prank(creator1);
        crp.claimPayment(id, 1);
        assertEq(usdc.balanceOf(creator1), AMT1 + AMT2);
    }

    /// Max creators (20) — must succeed
    function test_createCampaign_maxCreators() public {
        address[] memory w = new address[](20);
        uint256[] memory a = new uint256[](20);
        for (uint256 i = 0; i < 20; i++) {
            w[i] = address(uint160(0x1000 + i));
            a[i] = 1e6;
        }
        usdc.mint(brand, 20e6);
        vm.prank(brand);
        uint256 id = crp.createCampaign("T", "", fundDeadline, approvalDeadline, 0, w, a);
        assertEq(crp.getCreatorCount(id), 20);
    }

    /// Zero creators must revert
    function test_createCampaign_revert_zeroCreators() public {
        address[] memory w = new address[](0);
        uint256[] memory a = new uint256[](0);
        vm.prank(brand);
        vm.expectRevert();
        crp.createCampaign("T", "", fundDeadline, approvalDeadline, 0, w, a);
    }

    /// Mismatched wallet/amount arrays must revert
    function test_createCampaign_revert_lengthMismatch() public {
        address[] memory w = new address[](2);
        uint256[] memory a = new uint256[](1);
        w[0] = creator1; w[1] = creator2; a[0] = AMT1;
        vm.prank(brand);
        vm.expectRevert();
        crp.createCampaign("T", "", fundDeadline, approvalDeadline, 0, w, a);
    }
}

// ════════════════════════════════════════════════════════════════════════
// B) fundCampaign
// ════════════════════════════════════════════════════════════════════════
contract TestFund is CreatorsRoomPayBase {
    function test_fund_success() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        assertEq(usdc.balanceOf(address(crp)), TOTAL);
        assertEq(_campaignStatus(id), 1, "Active");
    }

    function test_fund_revert_notBrand() public {
        uint256 id = _createCampaign(0);
        vm.startPrank(creator1);
        usdc.approve(address(crp), TOTAL);
        vm.expectRevert();
        crp.fundCampaign(id);
        vm.stopPrank();
    }

    function test_fund_revert_deadlinePassed() public {
        uint256 id = _createCampaign(0);
        vm.warp(fundDeadline + 1);
        vm.prank(brand);
        vm.expectRevert();
        crp.fundCampaign(id);
    }

    function test_fund_revert_alreadyFunded() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.startPrank(brand);
        usdc.approve(address(crp), TOTAL);
        vm.expectRevert();
        crp.fundCampaign(id);
        vm.stopPrank();
    }

    /// Fee-on-transfer token: fundCampaign must revert (audit fix H-1).
    function test_fund_revert_feeOnTransferToken() public {
        FeeOnTransferUSDC feeToken = new FeeOnTransferUSDC();
        CreatorsRoomPay c = new CreatorsRoomPay(address(feeToken));

        feeToken.mint(brand, TOTAL);
        vm.startPrank(brand);
        uint256 id = c.createCampaign(
            "T", "", fundDeadline, approvalDeadline, 0, _defaultWallets(), _defaultAmounts()
        );
        feeToken.approve(address(c), TOTAL);
        vm.expectRevert(); // balance check: received != totalBudget
        c.fundCampaign(id);
        vm.stopPrank();
    }

    /// Return-false transferFrom: must revert the fund attempt.
    function test_fund_revert_transferFromReturnsFalse() public {
        ReturnFalseUSDC rfToken = new ReturnFalseUSDC();
        CreatorsRoomPay c = new CreatorsRoomPay(address(rfToken));

        rfToken.mint(brand, TOTAL);
        vm.startPrank(brand);
        uint256 id = c.createCampaign(
            "T", "", fundDeadline, approvalDeadline, 0, _defaultWallets(), _defaultAmounts()
        );
        rfToken.approve(address(c), TOTAL);
        rfToken.setFailTransferFrom(true);
        vm.expectRevert();
        c.fundCampaign(id);
        vm.stopPrank();
    }
}

// ════════════════════════════════════════════════════════════════════════
// C) submitDeliverable
// ════════════════════════════════════════════════════════════════════════
contract TestDeliverable is CreatorsRoomPayBase {
    function test_submitDeliverable_success() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(creator1);
        crp.submitDeliverable(id, 0, "https://example.com/deliverable");
        (,, string memory link,) = crp.getCreator(id, 0);
        assertEq(link, "https://example.com/deliverable");
    }

    function test_submitDeliverable_revert_notCreator() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(brand);
        vm.expectRevert();
        crp.submitDeliverable(id, 0, "https://example.com");
    }

    function test_submitDeliverable_revert_emptyLink() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(creator1);
        vm.expectRevert(CreatorsRoomPay.EmptyDeliverableLink.selector);
        crp.submitDeliverable(id, 0, "");
    }

    function test_submitDeliverable_revert_wrongCreatorIndex() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        // creator1 is at index 0, trying index 1 (creator2's slot) must revert
        vm.prank(creator1);
        vm.expectRevert();
        crp.submitDeliverable(id, 1, "https://example.com");
    }

    function test_submitDeliverable_revert_invalidIndex() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(creator1);
        vm.expectRevert();
        crp.submitDeliverable(id, 99, "https://example.com");
    }
}

// ════════════════════════════════════════════════════════════════════════
// D) approveCampaign
// ════════════════════════════════════════════════════════════════════════
contract TestApprove is CreatorsRoomPayBase {
    function test_approve_success() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);
        assertEq(_campaignStatus(id), 2, "Approved");
    }

    function test_approve_revert_notBrand() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(creator1);
        vm.expectRevert();
        crp.approveCampaign(id);
    }

    /// Audit fix: approval at exactly approvalDeadline must now revert.
    function test_approve_revert_atDeadline() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.warp(approvalDeadline); // exactly at the boundary
        vm.prank(brand);
        vm.expectRevert(
            abi.encodeWithSelector(
                CreatorsRoomPay.ApprovalDeadlinePassed.selector,
                approvalDeadline,
                block.timestamp
            )
        );
        crp.approveCampaign(id);
    }

    function test_approve_revert_deadlinePassed() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.warp(approvalDeadline + 1);
        vm.prank(brand);
        vm.expectRevert();
        crp.approveCampaign(id);
    }

    function test_approve_revert_notFunded() public {
        uint256 id = _createCampaign(0);
        vm.prank(brand);
        vm.expectRevert();
        crp.approveCampaign(id);
    }

    /// Double-approve must revert on the second call.
    function test_approve_revert_doubleApprove() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);
        vm.prank(brand);
        vm.expectRevert(); // status is Approved, not Active
        crp.approveCampaign(id);
    }

    /// Invariant 1: only the brand can approve. Nobody else can.
    function test_approve_invariant_onlyBrand() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        address[] memory attackers = new address[](3);
        attackers[0] = creator1;
        attackers[1] = creator2;
        attackers[2] = makeAddr("random");
        for (uint256 i = 0; i < attackers.length; i++) {
            vm.prank(attackers[i]);
            vm.expectRevert();
            crp.approveCampaign(id);
        }
    }

    /// Approval must succeed one second before the deadline.
    function test_approve_success_oneSecondBeforeDeadline() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.warp(approvalDeadline - 1);
        vm.prank(brand);
        crp.approveCampaign(id);
        assertEq(_campaignStatus(id), 2, "Approved");
    }
}

// ════════════════════════════════════════════════════════════════════════
// E) claimPayment
// ════════════════════════════════════════════════════════════════════════
contract TestClaim is CreatorsRoomPayBase {
    function test_claim_success_noUnlock() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);
        uint256 balBefore = usdc.balanceOf(creator1);
        vm.prank(creator1);
        crp.claimPayment(id, 0);
        assertEq(usdc.balanceOf(creator1), balBefore + AMT1);
        (,,,bool claimed) = crp.getCreator(id, 0);
        assertTrue(claimed);
    }

    function test_claim_success_unlockReached() public {
        uint64 unlock = approvalDeadline + 5 days;
        uint256 id = _createCampaign(unlock);
        _fundCampaign(id);
        _approveCampaign(id);
        vm.warp(unlock);
        uint256 balBefore = usdc.balanceOf(creator1);
        vm.prank(creator1);
        crp.claimPayment(id, 0);
        assertEq(usdc.balanceOf(creator1), balBefore + AMT1);
    }

    // Explicit clean test for the ClaimNotYetUnlocked revert path
    function test_claim_revert_unlockNotYetReached_clean() public {
        vm.warp(1);
        uint64 fd     = uint64(block.timestamp + 1 days);
        uint64 ad     = uint64(block.timestamp + 7 days);
        uint64 unlock = uint64(block.timestamp + 14 days);

        vm.prank(brand);
        uint256 id = crp.createCampaign("T", "", fd, ad, unlock, _defaultWallets(), _defaultAmounts());

        vm.startPrank(brand);
        usdc.approve(address(crp), TOTAL);
        crp.fundCampaign(id);
        vm.stopPrank();

        vm.warp(block.timestamp + 6 days);
        vm.prank(brand);
        crp.approveCampaign(id);

        vm.warp(block.timestamp + 1 days); // day 7, before unlock at day 14
        vm.prank(creator1);
        vm.expectRevert(
            abi.encodeWithSelector(CreatorsRoomPay.ClaimNotYetUnlocked.selector, unlock, block.timestamp)
        );
        crp.claimPayment(id, 0);
    }

    function test_claim_revert_notCreator() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);
        vm.prank(brand);
        vm.expectRevert();
        crp.claimPayment(id, 0);
    }

    /// Creator1 cannot claim Creator2's slot by passing a different index.
    function test_claim_revert_wrongIndex() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);
        // creator1 tries to claim creator2's allocation (index 1)
        vm.prank(creator1);
        vm.expectRevert();
        crp.claimPayment(id, 1);
    }

    function test_claim_revert_alreadyClaimed() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);
        vm.prank(creator1);
        crp.claimPayment(id, 0);
        vm.prank(creator1);
        vm.expectRevert();
        crp.claimPayment(id, 0);
    }

    function test_claim_revert_notApproved() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(creator1);
        vm.expectRevert();
        crp.claimPayment(id, 0);
    }

    function test_claim_bothCreators() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);
        vm.prank(creator1);
        crp.claimPayment(id, 0);
        vm.prank(creator2);
        crp.claimPayment(id, 1);
        assertEq(usdc.balanceOf(creator1), AMT1);
        assertEq(usdc.balanceOf(creator2), AMT2);
        assertEq(usdc.balanceOf(address(crp)), 0);
    }

    /// Transfer returns false: claimed must NOT be set to true (atomicity).
    function test_claim_revert_transferReturnsFalse() public {
        ReturnFalseUSDC rfToken = new ReturnFalseUSDC();
        rfToken.mint(brand, TOTAL);
        CreatorsRoomPay c = new CreatorsRoomPay(address(rfToken));

        vm.startPrank(brand);
        uint256 id = c.createCampaign(
            "T", "", fundDeadline, approvalDeadline, 0, _defaultWallets(), _defaultAmounts()
        );
        rfToken.approve(address(c), TOTAL);
        c.fundCampaign(id);
        c.approveCampaign(id);
        vm.stopPrank();

        rfToken.setFailTransfer(true);
        vm.prank(creator1);
        vm.expectRevert();
        c.claimPayment(id, 0);

        // State must NOT have changed — claimed is still false
        (,,, bool claimed) = c.getCreator(id, 0);
        assertFalse(claimed, "claimed must remain false when transfer reverts");
    }

    /// Invariant 2: no creator can redirect another creator's allocation.
    function test_claim_invariant_noRedirect() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);

        uint256 balBefore2 = usdc.balanceOf(creator2);
        // creator1 tries every valid index except their own
        vm.prank(creator1);
        vm.expectRevert();
        crp.claimPayment(id, 1); // creator2's slot

        // creator2's balance must be untouched
        assertEq(usdc.balanceOf(creator2), balBefore2);
    }
}

// ════════════════════════════════════════════════════════════════════════
// F) refundBrand
// ════════════════════════════════════════════════════════════════════════
contract TestRefund is CreatorsRoomPayBase {
    function test_refund_success() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.warp(approvalDeadline + 1);
        uint256 balBefore = usdc.balanceOf(brand);
        vm.prank(brand);
        crp.refundBrand(id);
        assertEq(usdc.balanceOf(brand), balBefore + TOTAL);
        assertEq(_campaignStatus(id), 3, "Refunded");
    }

    function test_refund_revert_deadlineNotPassed() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(brand);
        vm.expectRevert();
        crp.refundBrand(id);
    }

    /// Refund is available strictly AFTER approvalDeadline, not at it.
    function test_refund_revert_atDeadline() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.warp(approvalDeadline); // exactly at deadline
        vm.prank(brand);
        vm.expectRevert(
            abi.encodeWithSelector(
                CreatorsRoomPay.ApprovalDeadlineNotPassed.selector,
                approvalDeadline,
                block.timestamp
            )
        );
        crp.refundBrand(id);
    }

    function test_refund_revert_afterApproval() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);
        vm.warp(approvalDeadline + 1);
        vm.prank(brand);
        vm.expectRevert(); // status is Approved, not Active
        crp.refundBrand(id);
    }

    function test_refund_revert_notBrand() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.warp(approvalDeadline + 1);
        vm.prank(creator1);
        vm.expectRevert();
        crp.refundBrand(id);
    }

    /// Double-refund must revert on the second call (status becomes Refunded).
    function test_refund_revert_doubleRefund() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.warp(approvalDeadline + 1);
        vm.prank(brand);
        crp.refundBrand(id);
        vm.prank(brand);
        vm.expectRevert();
        crp.refundBrand(id);
    }

    /// Invariant 1: only the brand can reclaim. Multiple other callers must fail.
    function test_refund_invariant_onlyBrand() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.warp(approvalDeadline + 1);

        address[3] memory attackers = [creator1, creator2, makeAddr("random")];
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(attackers[i]);
            vm.expectRevert();
            crp.refundBrand(id);
        }
    }

    /// Return-false transfer: status must remain Active, not Refunded.
    function test_refund_revert_transferReturnsFalse() public {
        ReturnFalseUSDC rfToken = new ReturnFalseUSDC();
        rfToken.mint(brand, TOTAL);
        CreatorsRoomPay c = new CreatorsRoomPay(address(rfToken));

        vm.startPrank(brand);
        uint256 id = c.createCampaign(
            "T", "", fundDeadline, approvalDeadline, 0, _defaultWallets(), _defaultAmounts()
        );
        rfToken.approve(address(c), TOTAL);
        c.fundCampaign(id);
        vm.stopPrank();

        vm.warp(approvalDeadline + 1);
        rfToken.setFailTransfer(true);
        vm.prank(brand);
        vm.expectRevert();
        c.refundBrand(id);

        // Status must still be Active, not Refunded
        CreatorsRoomPay.Status st;
        (,,,,,,st,) = c.campaigns(id);
        assertEq(uint8(st), 1, "must still be Active");
    }
}

// ════════════════════════════════════════════════════════════════════════
// G) replaceCreator
// ════════════════════════════════════════════════════════════════════════
contract TestReplaceCreator is CreatorsRoomPayBase {
    address internal newCreator = makeAddr("newCreator");

    function test_replaceCreator_success() public {
        uint256 id = _createCampaign(0);
        vm.prank(brand);
        crp.replaceCreator(id, 0, newCreator);
        (address w,,,) = crp.getCreator(id, 0);
        assertEq(w, newCreator);
    }

    function test_replaceCreator_revert_afterFunded() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(brand);
        vm.expectRevert();
        crp.replaceCreator(id, 0, newCreator);
    }

    function test_replaceCreator_revert_notBrand() public {
        uint256 id = _createCampaign(0);
        vm.prank(creator1);
        vm.expectRevert();
        crp.replaceCreator(id, 0, newCreator);
    }

    function test_replaceCreator_revert_zeroAddress() public {
        uint256 id = _createCampaign(0);
        vm.prank(brand);
        vm.expectRevert();
        crp.replaceCreator(id, 0, address(0));
    }

    function test_replaceCreator_revert_invalidIndex() public {
        uint256 id = _createCampaign(0);
        vm.prank(brand);
        vm.expectRevert();
        crp.replaceCreator(id, 99, newCreator);
    }
}

// ════════════════════════════════════════════════════════════════════════
// H) Scheduled Unlock
// ════════════════════════════════════════════════════════════════════════
contract TestScheduledUnlock is CreatorsRoomPayBase {
    function test_unlock_zero_allowsImmediateClaim() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);
        vm.prank(creator1);
        crp.claimPayment(id, 0);
        assertTrue(true);
    }

    function test_unlock_blocksClaimBeforeTimestamp() public {
        uint64 unlock = approvalDeadline + 30 days;
        vm.prank(brand);
        uint256 id = crp.createCampaign("U", "", fundDeadline, approvalDeadline, unlock, _defaultWallets(), _defaultAmounts());
        _fundCampaign(id);
        _approveCampaign(id);
        vm.warp(unlock - 1);
        vm.prank(creator1);
        vm.expectRevert(
            abi.encodeWithSelector(CreatorsRoomPay.ClaimNotYetUnlocked.selector, unlock, block.timestamp)
        );
        crp.claimPayment(id, 0);
    }

    function test_unlock_allowsClaimAtExactTimestamp() public {
        uint64 unlock = approvalDeadline + 30 days;
        vm.prank(brand);
        uint256 id = crp.createCampaign("U", "", fundDeadline, approvalDeadline, unlock, _defaultWallets(), _defaultAmounts());
        _fundCampaign(id);
        _approveCampaign(id);
        vm.warp(unlock);
        vm.prank(creator1);
        crp.claimPayment(id, 0);
    }

    function test_unlock_allowsClaimAfterTimestamp() public {
        uint64 unlock = approvalDeadline + 7 days;
        vm.prank(brand);
        uint256 id = crp.createCampaign("U", "", fundDeadline, approvalDeadline, unlock, _defaultWallets(), _defaultAmounts());
        _fundCampaign(id);
        _approveCampaign(id);
        vm.warp(unlock + 1 days);
        vm.prank(creator2);
        crp.claimPayment(id, 1);
    }

    function test_unlock_revert_unlockEqualToApprovalDeadline() public {
        vm.prank(brand);
        vm.expectRevert(
            abi.encodeWithSelector(CreatorsRoomPay.InvalidClaimUnlockTime.selector, approvalDeadline, approvalDeadline)
        );
        crp.createCampaign("T", "", fundDeadline, approvalDeadline, approvalDeadline, _defaultWallets(), _defaultAmounts());
    }

    function test_unlock_revert_unlockBeforeApprovalDeadline() public {
        vm.prank(brand);
        vm.expectRevert();
        crp.createCampaign("T", "", fundDeadline, approvalDeadline, fundDeadline, _defaultWallets(), _defaultAmounts());
    }

    function test_unlock_independentCreatorClaims() public {
        uint64 unlock = approvalDeadline + 10 days;
        vm.prank(brand);
        uint256 id = crp.createCampaign("U", "", fundDeadline, approvalDeadline, unlock, _defaultWallets(), _defaultAmounts());
        _fundCampaign(id);
        _approveCampaign(id);
        vm.warp(unlock);
        vm.prank(creator1);
        crp.claimPayment(id, 0);
        vm.prank(creator2);
        crp.claimPayment(id, 1);
        assertEq(usdc.balanceOf(creator1), AMT1);
        assertEq(usdc.balanceOf(creator2), AMT2);
    }

    function test_unlock_frozenAfterFunding() public {
        uint64 unlock = approvalDeadline + 5 days;
        vm.prank(brand);
        uint256 id = crp.createCampaign("U", "", fundDeadline, approvalDeadline, unlock, _defaultWallets(), _defaultAmounts());
        _fundCampaign(id);
        assertEq(_campaignCut(id), unlock);
    }

    function test_unlock_event_contains_unlockTime() public {
        uint64 unlock = approvalDeadline + 3 days;
        vm.prank(brand);
        vm.expectEmit(true, true, false, true);
        emit CreatorsRoomPay.CampaignCreated(0, brand, TOTAL, unlock);
        crp.createCampaign("U", "", fundDeadline, approvalDeadline, unlock, _defaultWallets(), _defaultAmounts());
    }
}

// ════════════════════════════════════════════════════════════════════════
// I) Reentrancy
// ════════════════════════════════════════════════════════════════════════
contract TestReentrancy is CreatorsRoomPayBase {
    /// A malicious ERC-20 that re-enters claimPayment on transfer must not
    /// allow the attacker to claim twice (CEI pattern prevents it).
    function test_reentrancy_claimPayment_protected() public {
        ReentrantUSDC rToken = new ReentrantUSDC();
        CreatorsRoomPay c = new CreatorsRoomPay(address(rToken));

        ReentrancyAttacker attacker = new ReentrancyAttacker();

        // Set up: attacker is creator1 wallet
        address[] memory w = new address[](1);
        uint256[] memory a = new uint256[](1);
        w[0] = address(attacker);
        a[0] = AMT1;

        rToken.mint(brand, AMT1);
        vm.startPrank(brand);
        uint256 id = c.createCampaign("R", "", fundDeadline, approvalDeadline, 0, w, a);
        rToken.approve(address(c), AMT1);
        c.fundCampaign(id);
        c.approveCampaign(id);
        vm.stopPrank();

        // Configure the reentrant token to call back into the attacker
        rToken.setAttacker(address(attacker));
        attacker.setup(address(c), id, 0);

        // Contract balance before
        uint256 contractBalBefore = rToken.balanceOf(address(c));

        // Claim — re-entry attempt from inside the token transfer hook
        attacker.claim();

        // Despite re-entry attempt, only AMT1 should have left the contract
        uint256 contractBalAfter = rToken.balanceOf(address(c));
        assertEq(contractBalBefore - contractBalAfter, AMT1, "only one payment should leave");

        // claimed flag must be true (not false, which would allow further claims)
        (,,, bool claimed) = c.getCreator(id, 0);
        assertTrue(claimed, "must be marked claimed");
    }
}

// ════════════════════════════════════════════════════════════════════════
// J) Transfer-fail atomicity
// ════════════════════════════════════════════════════════════════════════
contract TestTransferAtomicity is CreatorsRoomPayBase {
    /// If transfer returns false during claimPayment, state must be unchanged.
    function test_atomicity_claim_noPartialState() public {
        ReturnFalseUSDC rfToken = new ReturnFalseUSDC();
        rfToken.mint(brand, TOTAL);
        CreatorsRoomPay c = new CreatorsRoomPay(address(rfToken));

        vm.startPrank(brand);
        uint256 id = c.createCampaign("T", "", fundDeadline, approvalDeadline, 0, _defaultWallets(), _defaultAmounts());
        rfToken.approve(address(c), TOTAL);
        c.fundCampaign(id);
        c.approveCampaign(id);
        vm.stopPrank();

        rfToken.setFailTransfer(true);
        vm.prank(creator1);
        vm.expectRevert();
        c.claimPayment(id, 0);

        (,,, bool claimed) = c.getCreator(id, 0);
        assertFalse(claimed);
        assertEq(rfToken.balanceOf(address(c)), TOTAL, "contract balance must be unchanged");
    }

    /// If transfer returns false during refundBrand, status must remain Active.
    function test_atomicity_refund_noPartialState() public {
        ReturnFalseUSDC rfToken = new ReturnFalseUSDC();
        rfToken.mint(brand, TOTAL);
        CreatorsRoomPay c = new CreatorsRoomPay(address(rfToken));

        vm.startPrank(brand);
        uint256 id = c.createCampaign("T", "", fundDeadline, approvalDeadline, 0, _defaultWallets(), _defaultAmounts());
        rfToken.approve(address(c), TOTAL);
        c.fundCampaign(id);
        vm.stopPrank();

        vm.warp(approvalDeadline + 1);
        rfToken.setFailTransfer(true);
        vm.prank(brand);
        vm.expectRevert();
        c.refundBrand(id);

        CreatorsRoomPay.Status st;
        (,,,,,,st,) = c.campaigns(id);
        assertEq(uint8(st), 1, "must still be Active");
    }
}

// ════════════════════════════════════════════════════════════════════════
// K) Cross-campaign isolation
// ════════════════════════════════════════════════════════════════════════
contract TestCrossCampaignIsolation is CreatorsRoomPayBase {
    address internal brand2    = makeAddr("brand2");
    address internal creator3  = makeAddr("creator3");

    /// Invariant 6: Campaign A's brand cannot consume Campaign B's escrowed funds.
    function test_isolation_brandCannotDrainOtherCampaign() public {
        usdc.mint(brand2, 10_000e6);

        // Campaign 0: brand owns it
        uint256 id0 = _createCampaign(0);
        _fundCampaign(id0);

        // Campaign 1: brand2 owns it
        address[] memory w2 = new address[](1);
        uint256[] memory a2 = new uint256[](1);
        w2[0] = creator3;
        a2[0] = 200e6;
        vm.startPrank(brand2);
        uint256 id1 = crp.createCampaign("C2", "", fundDeadline, approvalDeadline, 0, w2, a2);
        usdc.approve(address(crp), 200e6);
        crp.fundCampaign(id1);
        vm.stopPrank();

        // brand approves campaign 0 and campaign 0 creators can claim
        _approveCampaign(id0);
        vm.prank(creator1);
        crp.claimPayment(id0, 0);
        vm.prank(creator2);
        crp.claimPayment(id0, 1);

        // Campaign 1's funds (200 USDC) must still be intact
        assertEq(usdc.balanceOf(address(crp)), 200e6, "campaign1 funds must be untouched");

        // brand cannot refund campaign 1 (not the brand for it)
        vm.warp(approvalDeadline + 1);
        vm.prank(brand);
        vm.expectRevert();
        crp.refundBrand(id1);

        // brand2 can refund its own campaign
        vm.prank(brand2);
        crp.refundBrand(id1);
        assertEq(usdc.balanceOf(brand2), 10_000e6, "brand2 gets its money back");
    }

    /// Creator from campaign 0 cannot claim from campaign 1.
    function test_isolation_creatorCannotClaimCrossCAMPAIGN() public {
        // Campaign 0
        uint256 id0 = _createCampaign(0);
        _fundCampaign(id0);
        _approveCampaign(id0);

        // Campaign 1 with different creators
        usdc.mint(brand, 1000e6);
        address[] memory w2 = new address[](1);
        uint256[] memory a2 = new uint256[](1);
        w2[0] = creator3;
        a2[0] = 200e6;
        vm.startPrank(brand);
        uint256 id1 = crp.createCampaign("C2", "", fundDeadline, approvalDeadline, 0, w2, a2);
        usdc.approve(address(crp), 200e6);
        crp.fundCampaign(id1);
        crp.approveCampaign(id1);
        vm.stopPrank();

        // creator1 (in campaign 0) tries to claim from campaign 1
        vm.prank(creator1);
        vm.expectRevert();
        crp.claimPayment(id1, 0);
    }
}

// ════════════════════════════════════════════════════════════════════════
// L) Invariant / admin drain path
// ════════════════════════════════════════════════════════════════════════
contract TestInvariants is CreatorsRoomPayBase {
    /// Invariant 9: no function allows draining the contract's USDC balance.
    function test_invariant_noAdminWithdraw() public {
        _fundCampaign(_createCampaign(0));
        assertEq(usdc.balanceOf(address(crp)), TOTAL);

        // No withdraw/sweep/rescue/drain function should exist:
        // attempt via low-level calls with common selectors
        bytes4[4] memory selectors = [
            bytes4(keccak256("withdraw(uint256)")),
            bytes4(keccak256("sweep(address,uint256)")),
            bytes4(keccak256("rescueTokens(address,uint256)")),
            bytes4(keccak256("drain(address)"
            ))
        ];

        for (uint256 i = 0; i < selectors.length; i++) {
            (bool ok,) = address(crp).call(abi.encodePacked(selectors[i]));
            assertFalse(ok, "admin drain selector must not exist");
        }

        // Contract balance must be untouched
        assertEq(usdc.balanceOf(address(crp)), TOTAL);
    }

    /// Invariant 7: after all claims, contract balance should be zero.
    function test_invariant_budgetConservation_allClaims() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        _approveCampaign(id);

        vm.prank(creator1);
        crp.claimPayment(id, 0);
        vm.prank(creator2);
        crp.claimPayment(id, 1);

        assertEq(usdc.balanceOf(address(crp)), 0);
        assertEq(usdc.balanceOf(creator1), AMT1);
        assertEq(usdc.balanceOf(creator2), AMT2);
    }

    /// Invariant 7: refund must return exactly totalBudget, leaving 0 in contract.
    function test_invariant_budgetConservation_refund() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        uint256 brandBalBefore = usdc.balanceOf(brand);
        vm.warp(approvalDeadline + 1);
        vm.prank(brand);
        crp.refundBrand(id);
        assertEq(usdc.balanceOf(brand), brandBalBefore + TOTAL);
        assertEq(usdc.balanceOf(address(crp)), 0);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// N) approveAndPayAll — immediate-payment flow
// ═══════════════════════════════════════════════════════════════════════════

// Mock: blocks transfer to a specific address (simulates USDC blocklist mid-batch)
contract BlockingUSDC is MockUSDC {
    address public blocked;
    function setBlocked(address a) external { blocked = a; }
    function transfer(address to, uint256 amount) external override returns (bool) {
        if (to == blocked) return false;
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TestApproveAndPayAll is CreatorsRoomPayBase {

    // ── N-1: success — both creators receive USDC in same tx ────────────
    function test_approveAndPayAll_success() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);

        uint256 c1Before = usdc.balanceOf(creator1);
        uint256 c2Before = usdc.balanceOf(creator2);
        uint256 brandBefore = usdc.balanceOf(brand);

        vm.prank(brand);
        crp.approveAndPayAll(id);

        // Each creator received their allocation
        assertEq(usdc.balanceOf(creator1), c1Before + AMT1, "creator1 paid");
        assertEq(usdc.balanceOf(creator2), c2Before + AMT2, "creator2 paid");
        // Brand wallet unchanged (funds were already in escrow)
        assertEq(usdc.balanceOf(brand), brandBefore, "brand unchanged");
        // Contract balance is zero
        assertEq(usdc.balanceOf(address(crp)), 0, "contract empty");
        // Campaign status is Approved
        assertEq(uint8(_campaignStatus(id)), uint8(CreatorsRoomPay.Status.Approved));
    }

    // ── N-2: both claimed flags set atomically ───────────────────────────
    function test_approveAndPayAll_claimedFlagsSet() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(brand);
        crp.approveAndPayAll(id);
        (, , , bool c0Claimed) = crp.getCreator(id, 0);
        (, , , bool c1Claimed) = crp.getCreator(id, 1);
        assertTrue(c0Claimed, "creator 0 claimed flag");
        assertTrue(c1Claimed, "creator 1 claimed flag");
    }

    // ── N-3: duplicate call reverts (status no longer Active) ───────────
    function test_approveAndPayAll_doubleCall_reverts() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(brand);
        crp.approveAndPayAll(id);
        // Second call: status is now Approved, not Active
        vm.prank(brand);
        vm.expectRevert(
            abi.encodeWithSelector(
                CreatorsRoomPay.InvalidCampaignStatus.selector,
                CreatorsRoomPay.Status.Active,
                CreatorsRoomPay.Status.Approved
            )
        );
        crp.approveAndPayAll(id);
    }

    // ── N-4: unauthorized caller reverts ────────────────────────────────
    function test_approveAndPayAll_unauthorized_reverts() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(creator1);
        vm.expectRevert(
            abi.encodeWithSelector(CreatorsRoomPay.OnlyBrand.selector, creator1, brand)
        );
        crp.approveAndPayAll(id);
    }

    // ── N-5: scheduled-unlock campaign reverts ───────────────────────────
    function test_approveAndPayAll_scheduledUnlock_reverts() public {
        uint64 unlock = uint64(approvalDeadline + 100);
        uint256 id = _createCampaign(unlock);
        _fundCampaign(id);
        vm.prank(brand);
        vm.expectRevert(
            abi.encodeWithSelector(
                CreatorsRoomPay.ScheduledUnlockCampaign.selector,
                id, unlock
            )
        );
        crp.approveAndPayAll(id);
    }

    // ── N-6: after approvalDeadline reverts ─────────────────────────────
    function test_approveAndPayAll_afterDeadline_reverts() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.warp(approvalDeadline); // at the boundary → strict-before check fires
        vm.prank(brand);
        vm.expectRevert(
            abi.encodeWithSelector(
                CreatorsRoomPay.ApprovalDeadlinePassed.selector,
                uint64(approvalDeadline), block.timestamp
            )
        );
        crp.approveAndPayAll(id);
    }

    // ── N-7: partial-transfer-fail reverts entire tx (atomicity) ────────
    //  One creator is blocked → no creator is paid, no state changes
    function test_approveAndPayAll_transferFail_reverts_atomically() public {
        BlockingUSDC bUsdc = new BlockingUSDC();
        CreatorsRoomPay bCrp = new CreatorsRoomPay(address(bUsdc));

        address[] memory w = new address[](2);
        w[0] = creator1; w[1] = creator2;
        uint256[] memory a = new uint256[](2);
        a[0] = AMT1; a[1] = AMT2;

        vm.prank(brand);
        uint256 id = bCrp.createCampaign(
            "blocked", "", uint64(fundDeadline), uint64(approvalDeadline), 0, w, a
        );

        bUsdc.mint(brand, AMT1 + AMT2);
        vm.prank(brand);
        bUsdc.approve(address(bCrp), AMT1 + AMT2);
        vm.prank(brand);
        bCrp.fundCampaign(id);

        // Block creator2's transfer
        bUsdc.setBlocked(creator2);

        uint256 c1Before = bUsdc.balanceOf(creator1);
        uint256 c2Before = bUsdc.balanceOf(creator2);

        vm.prank(brand);
        vm.expectRevert(
            abi.encodeWithSelector(CreatorsRoomPay.TransferFailed.selector, creator2, AMT2)
        );
        bCrp.approveAndPayAll(id);

        // State must be unchanged: no transfers completed, status still Active
        assertEq(bUsdc.balanceOf(creator1), c1Before, "creator1 not paid");
        assertEq(bUsdc.balanceOf(creator2), c2Before, "creator2 not paid");
        assertEq(uint8(bCrp.getCampaignStatus(id)), uint8(CreatorsRoomPay.Status.Active));
    }

    // ── N-8: budget conservation after approveAndPayAll ─────────────────
    function test_approveAndPayAll_budgetConservation() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(brand);
        crp.approveAndPayAll(id);
        assertEq(usdc.balanceOf(address(crp)), 0, "contract must be empty");
        assertEq(usdc.balanceOf(creator1) + usdc.balanceOf(creator2), TOTAL, "total conserved");
    }

    // ── N-9: claimPayment disabled after approveAndPayAll ───────────────
    //  creators cannot double-collect by also calling claimPayment
    function test_approveAndPayAll_claimPayment_disabled() public {
        uint256 id = _createCampaign(0);
        _fundCampaign(id);
        vm.prank(brand);
        crp.approveAndPayAll(id);
        vm.prank(creator1);
        vm.expectRevert(
            abi.encodeWithSelector(
                CreatorsRoomPay.AlreadyClaimed.selector, id, 0
            )
        );
        crp.claimPayment(id, 0);
    }

    // ── N-10: cross-campaign isolation — approveAndPayAll on one campaign
    //  does not affect a second funded campaign's escrow balance
    function test_approveAndPayAll_crossCampaignIsolation() public {
        uint256 id1 = _createCampaign(0);
        _fundCampaign(id1);

        // Create a second independent campaign
        address c3 = address(0x9999);
        address[] memory w = new address[](1);
        w[0] = c3;
        uint256[] memory a = new uint256[](1);
        a[0] = 3_000_000;
        vm.prank(brand);
        uint256 id2 = crp.createCampaign(
            "camp2", "", uint64(fundDeadline), uint64(approvalDeadline), 0, w, a
        );
        usdc.mint(brand, 3_000_000);
        vm.prank(brand);
        usdc.approve(address(crp), 3_000_000);
        vm.prank(brand);
        crp.fundCampaign(id2);

        uint256 contractBefore = usdc.balanceOf(address(crp)); // TOTAL + 3_000_000

        // Approve-and-pay campaign 1 only
        vm.prank(brand);
        crp.approveAndPayAll(id1);

        // Campaign 2's funds must still be in escrow
        assertEq(usdc.balanceOf(address(crp)), contractBefore - TOTAL, "campaign2 intact");
        assertEq(uint8(crp.getCampaignStatus(id2)), uint8(CreatorsRoomPay.Status.Active));
    }
}
