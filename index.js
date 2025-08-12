import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { google } from "googleapis";

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());

// 1️⃣ MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

// 2️⃣ Message Schema
const MessageSchema = new mongoose.Schema({
  name: String,
  email: String,
  message: String,
  createdAt: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", MessageSchema);

// 3️⃣ Token Schema (to store Gmail refresh token)
const TokenSchema = new mongoose.Schema({
  access_token: String,
  refresh_token: String,
  scope: String,
  token_type: String,
  expiry_date: Number,
});
const TokenModel = mongoose.model("Token", TokenSchema);

// 4️⃣ Google OAuth2 Setup
const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// 5️⃣ Auth Route (first time only)
app.get("/auth", (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.send"],
    prompt: "consent",
  });
  res.redirect(authUrl);
});

app.get("/oauth2callback", async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oAuth2Client.getToken(code);

  await TokenModel.deleteMany({});
  await TokenModel.create(tokens);

  res.send("✅ Gmail API connected! You can now use /contact to send emails.");
});

// 6️⃣ Send Email Function
async function sendEmail(name, email, message) {
  const savedTokens = await TokenModel.findOne();
  if (!savedTokens)
    throw new Error("No tokens found. Please visit /auth first.");

  oAuth2Client.setCredentials(savedTokens);
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  const emailContent = [
    `To: ${process.env.TO_EMAIL}`,
    "Subject: 📩 New Message from Your Portfolio Website",
    "Content-Type: text/html; charset=utf-8",
    "",
    `<h2>New Contact Form Submission</h2>
     <p><strong>Name:</strong> ${name}</p>
     <p><strong>Email:</strong> ${email}</p>
     <p><strong>Message:</strong> ${message}</p>`,
  ].join("\n");

  const encodedMessage = Buffer.from(emailContent)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage },
  });
}

// 7️⃣ Contact API
app.post("/contact", async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res
      .status(400)
      .json({ success: false, message: "All fields are required" });
  }

  try {
    // Save to DB
    await Message.create({ name, email, message });

    // Send Email via Gmail API
    await sendEmail(name, email, message);

    res.json({ success: true, message: "Message sent successfully" });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
});

// 8️⃣ Start Server
app.listen(process.env.PORT, () => {
  console.log(`🚀 Server running on port ${process.env.PORT}`);
});
