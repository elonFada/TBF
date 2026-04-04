import asyncHandler from "express-async-handler";
import { Resend } from "resend";
import Transaction from "../models/transactionModel.js";
import Withdrawal from "../models/withdrawalModel.js";
import User from "../models/userModel.js";

const resend = new Resend(process.env.RESEND_API_KEY);

// @desc    Create a deposit request
// @route   POST /api/transactions/deposit
// @access  Private
const depositPayment = asyncHandler(async (req, res) => {
  const { amount, asset, network, transactionId, paymentMethod } = req.body;

  if (!amount || !asset || !network || !transactionId) {
    res.status(400);
    throw new Error("Amount, asset, network, and transaction ID are required");
  }

  const numericAmount = Number(amount);

  if (Number.isNaN(numericAmount) || numericAmount <= 0) {
    res.status(400);
    throw new Error("Amount must be greater than 0");
  }

  const existing = await Transaction.findOne({ transactionId });
  if (existing) {
    res.status(400);
    throw new Error("This transaction ID has already been submitted");
  }

  const transaction = await Transaction.create({
    user: req.user._id,
    type: "deposit",
    amount: numericAmount,
    fee: 0,
    creditedAmount: 0,
    asset,
    network,
    transactionId,
    paymentMethod: paymentMethod || "crypto",
    proofOfPayment: req.file?.path || "",
    status: "pending",
  });

  res.status(201).json(transaction);
});

// @desc    Get logged in user's transactions
// @route   GET /api/transactions/my
// @access  Private
const getMyTransactions = asyncHandler(async (req, res) => {
  const transactions = await Transaction.find({ user: req.user._id }).sort({
    createdAt: -1,
  });

  res.status(200).json(transactions);
});

// @desc    Get logged in user's balance summary
// @route   GET /api/transactions/my/total
// @access  Private
const getMyTotalDeposit = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const depositResult = await Transaction.aggregate([
    {
      $match: {
        user: userId,
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

  const withdrawalResult = await Withdrawal.aggregate([
    {
      $match: {
        user: userId,
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

  const totalDeposited = depositResult[0]?.totalDeposited || 0;
  const totalReservedWithdrawals =
    withdrawalResult[0]?.totalReservedWithdrawals || 0;

  const availableBalance = totalDeposited - totalReservedWithdrawals;

  res.status(200).json({
    totalDeposited,
    totalReservedWithdrawals,
    availableBalance,
  });
});

// @desc    Get a specific user's balance summary (admin)
// @route   GET /api/transactions/admin/user-total/:userId
// @access  Private/Admin
const getUserTotalByAdmin = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const user = await User.findById(userId);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

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

  const totalDeposited = depositResult[0]?.totalDeposited || 0;
  const totalReservedWithdrawals =
    withdrawalResult[0]?.totalReservedWithdrawals || 0;

  const availableBalance = totalDeposited - totalReservedWithdrawals;

  res.status(200).json({
    userId: user._id,
    totalDeposited,
    totalReservedWithdrawals,
    availableBalance,
  });
});

// @desc    Set a user's exact dashboard balance (admin)
// @route   POST /api/transactions/admin/set-balance/:userId
// @access  Private/Admin
const setUserBalanceByAdmin = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { balance, note } = req.body;

  const desiredBalance = Number(balance);

  if (Number.isNaN(desiredBalance) || desiredBalance < 0) {
    res.status(400);
    throw new Error("Valid balance is required");
  }

  const user = await User.findById(userId).select("-password");
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

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

  const totalDeposited = depositResult[0]?.totalDeposited || 0;
  const totalReservedWithdrawals =
    withdrawalResult[0]?.totalReservedWithdrawals || 0;

  const currentAvailableBalance = totalDeposited - totalReservedWithdrawals;
  const difference = Number(
    (desiredBalance - currentAvailableBalance).toFixed(2)
  );

  if (difference === 0) {
    return res.status(200).json({
      message: "Balance already matches requested value",
      availableBalance: currentAvailableBalance,
    });
  }

  if (difference > 0) {
    await Transaction.create({
      user: user._id,
      type: "balance_adjustment",
      amount: difference,
      fee: 0,
      creditedAmount: difference,
      asset: "USD",
      network: "internal",
      transactionId: `ADJ-PLUS-${Date.now()}-${user._id}`,
      paymentMethod: "admin_adjustment",
      proofOfPayment: "",
      status: "approved",
      note: note || "Admin balance increase",
      description: `Balance set by admin from ${currentAvailableBalance} to ${desiredBalance}`,
    });
  } else {
    await Withdrawal.create({
      user: user._id,
      amount: Math.abs(difference),
      gasFee: 0,
      walletAddress: "ADMIN-BALANCE-ADJUSTMENT",
      network: "internal",
      status: "completed",
      note: note || "Admin balance decrease",
    });
  }

  const dashboardUrl = `${process.env.CLIENT_URL}/user-dashboard.html`;

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Account Balance Updated — TheBrave Finance</title>
</head>
<body style="margin:0;padding:0;background:#0a0f18;font-family:'Segoe UI',Arial,sans-serif;color:#e2e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f18;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <tr>
            <td style="background:#0f1825;border-radius:16px 16px 0 0;padding:32px 40px;border-bottom:1px solid #1e293b;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">
                THEBRAVE <span style="color:#1152d4;">FINANCE</span>
              </h1>
              <p style="margin:6px 0 0;color:#64748b;font-size:12px;letter-spacing:2px;">
                Account Balance Update
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#0f1825;padding:40px;">

              <p style="margin:0 0 10px;color:#94a3b8;font-size:14px;">
                Hello <strong style="color:#ffffff;">${user.name}</strong>,
              </p>

              <p style="margin:0 0 24px;color:#94a3b8;font-size:14px;line-height:1.6;">
                Your account balance has been successfully updated by our admin team.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#151c2c;border-radius:12px;border:1px solid #1e293b;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;border-bottom:1px solid #1e293b;">
                    <p style="margin:0 0 4px;color:#64748b;font-size:11px;">Previous Balance</p>
                    <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">
                      $${currentAvailableBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:20px 24px;border-bottom:1px solid #1e293b;">
                    <p style="margin:0 0 4px;color:#64748b;font-size:11px;">New Balance</p>
                    <p style="margin:0;color:#10b981;font-size:24px;font-weight:800;">
                      $${desiredBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 4px;color:#64748b;font-size:11px;">Adjustment</p>
                    <p style="margin:0;color:${difference >= 0 ? "#10b981" : "#f59e0b"};font-size:18px;font-weight:700;">
                      ${difference >= 0 ? "+" : "-"}$${Math.abs(difference).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                  </td>
                </tr>
              </table>

              ${
                note
                  ? `
              <div style="background:#101827;border-radius:12px;border:1px solid #1e293b;padding:20px;margin-bottom:24px;">
                <p style="margin:0 0 6px;color:#64748b;font-size:11px;">Admin Note</p>
                <p style="margin:0;color:#ffffff;font-size:13px;line-height:1.6;">
                  ${note}
                </p>
              </div>
              `
                  : ""
              }

              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center" bgcolor="#1152d4" style="border-radius:10px;">
                    <a href="${dashboardUrl}" target="_blank"
                      style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
                      Go to Dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;color:#64748b;font-size:12px;">
                If you were not expecting this update, please contact support immediately.
              </p>

            </td>
          </tr>

          <tr>
            <td style="background:#080d14;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;border-top:1px solid #1e293b;">
              <p style="margin:0;color:#1152d4;font-size:12px;font-weight:700;">
                THEBRAVE FINANCE
              </p>
              <p style="margin:6px 0 0;color:#334155;font-size:11px;">
                © 2000 TheBrave Finance Integrated Services
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const emailText = `
Hello ${user.name},

Your account balance has been successfully updated by our admin team.

Previous Balance: $${currentAvailableBalance.toLocaleString("en-US", {
    minimumFractionDigits: 2,
  })}
New Balance: $${desiredBalance.toLocaleString("en-US", {
    minimumFractionDigits: 2,
  })}
Adjustment: ${difference >= 0 ? "+" : "-"}$${Math.abs(difference).toLocaleString(
    "en-US",
    { minimumFractionDigits: 2 }
  )}

${note ? `Admin Note: ${note}` : ""}

Log in to your dashboard here:
${dashboardUrl}

If you were not expecting this update, please contact support immediately.

TheBrave Finance
`;

  const { error: emailError } = await resend.emails.send({
    from: "TheBrave Finance <support@thebravefinance.com>",
    to: [user.email],
    subject: "Your account balance has been updated",
    html: emailHtml,
    text: emailText,
    replyTo: "support@thebravefinance.com",
  });

  if (emailError) {
    console.error("Balance update email send error:", emailError);
    // Don't throw — balance update already succeeded
  }

  res.status(200).json({
    message: "User balance updated successfully",
    previousBalance: currentAvailableBalance,
    newBalance: desiredBalance,
    difference,
  });
});

// @desc    Get all transactions (admin)
// @route   GET /api/transactions
// @access  Private/Admin
const getAllTransactions = asyncHandler(async (req, res) => {
  const transactions = await Transaction.find({})
    .populate("user", "name email phone profile")
    .sort({ createdAt: -1 });

  res.status(200).json(transactions);
});

// @desc    Approve or reject a transaction (admin)
// @route   PUT /api/transactions/:id/status
// @access  Private/Admin
const updateTransactionStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    res.status(400);
    throw new Error("Status must be either approved or rejected");
  }

  const transaction = await Transaction.findById(req.params.id);

  if (!transaction) {
    res.status(404);
    throw new Error("Transaction not found");
  }

  if (transaction.status !== "pending") {
    res.status(400);
    throw new Error("Only pending transactions can be updated");
  }

  if (status === "approved") {
    if (transaction.type === "balance_adjustment") {
      transaction.status = "approved";
      transaction.fee = 0;
      transaction.creditedAmount = Number(transaction.amount.toFixed(2));
    } else {
      const FEE_PERCENT = 0.05;
      const fee = transaction.amount * FEE_PERCENT;
      const creditedAmount = transaction.amount - fee;

      transaction.status = "approved";
      transaction.fee = Number(fee.toFixed(2));
      transaction.creditedAmount = Number(creditedAmount.toFixed(2));
    }
  }

  if (status === "rejected") {
    transaction.status = "rejected";
    transaction.fee = 0;
    transaction.creditedAmount = 0;
  }

  const updated = await transaction.save();

  res.status(200).json(updated);
});

// @desc    Get a single transaction by ID
// @route   GET /api/transactions/:id
// @access  Private
const getTransactionById = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findById(req.params.id).populate(
    "user",
    "name email"
  );

  if (!transaction) {
    res.status(404);
    throw new Error("Transaction not found");
  }

  if (transaction.user._id.toString() !== req.user._id.toString()) {
    res.status(401);
    throw new Error("Not authorized to view this transaction");
  }

  res.status(200).json(transaction);
});

export {
  depositPayment,
  getMyTransactions,
  getMyTotalDeposit,
  getUserTotalByAdmin,
  setUserBalanceByAdmin,
  getAllTransactions,
  updateTransactionStatus,
  getTransactionById,
};