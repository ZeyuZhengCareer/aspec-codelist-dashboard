require("dotenv").config();
const express = require("express");
const serverless = require("serverless-http");
const sgMail = require("@sendgrid/mail");

const DEFAULT_FROM = process.env.EMAIL_DEFAULT_FROM || "noreply@example.com";
const SENDGRID_KEY = process.env.SENDGRID_API_KEY;

if (!SENDGRID_KEY) {
  console.warn("[WARN] SENDGRID_API_KEY is not set. Emails will fail until it is provided.");
} else {
  sgMail.setApiKey(SENDGRID_KEY);
}

const app = express();
app.use(express.json({ limit: "25mb" }));

// CORS - allow all origins for Netlify deployment
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/**
 * POST /api/send-codelist-email
 * Body: {
 *   to: string | string[],
 *   from?: string,
 *   replyTo?: string,
 *   subject: string,
 *   html: string,
 *   xlsxBase64?: string,
 *   filename?: string,
 *   cc?: string | string[],
 *   bcc?: string | string[]
 * }
 */
app.post("/api/send-codelist-email", async (req, res) => {
  try {
    const {
      to,
      from,
      replyTo,
      subject,
      html,
      xlsxBase64,
      filename = "codelist.xlsx",
      cc,
      bcc,
    } = req.body || {};

    if (!to || !subject || !html) {
      return res.status(400).json({ 
        ok: false, 
        error: "Missing required fields (to, subject, html)" 
      });
    }

    const msg = {
      to,
      from: from || DEFAULT_FROM,
      subject,
      html,
      replyTo: replyTo || from || DEFAULT_FROM,
      cc,
      bcc,
      categories: ["codelist-dashboard"],
    };

    // Add attachment only if provided
    if (xlsxBase64 && typeof xlsxBase64 === "string") {
      msg.attachments = [
        {
          content: xlsxBase64,
          filename,
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          disposition: "attachment",
        },
      ];
    }

    const [sgResp] = await sgMail.send(msg);
    return res.status(200).json({ ok: true, status: sgResp.statusCode });
  } catch (err) {
    const sgErr = err?.response?.body || err;
    console.error("SendGrid error:", sgErr);
    return res.status(502).json({
      ok: false,
      error: sgErr?.errors?.[0]?.message || "Email send failed",
    });
  }
});

// Root endpoint
app.get("/", (_req, res) => {
  res.type("text/plain").send("Email API is running. POST /api/send-codelist-email");
});

// Export for Netlify Functions
module.exports.handler = serverless(app);