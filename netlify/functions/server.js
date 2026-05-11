require("dotenv").config();
const express = require("express");
const serverless = require("serverless-http");
const sgMail = require("@sendgrid/mail");
const fs = require("fs");
const path = require("path");

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
 * GET /api/master-codelist
 * Scans the public/ folder for A-SPEC*.xlsx files and returns the latest one.
 * "Latest" is determined by the date embedded in the filename (YYYYMMDD pattern),
 * falling back to file modification time if no date is found.
 *
 * Response: { ok: true, filename: "A-SPEC CODELISTS Version 2.0.9 MASTER WIP - 20260508.xlsx" }
 */
app.get("/api/master-codelist", (_req, res) => {
  try {
    // Resolve public/ relative to this file's location
    // Works both locally (netlify/functions/server.js) and in Netlify Functions
    const candidates = [
      path.resolve(__dirname, "../../public"),   // netlify/functions/ → public/
      path.resolve(__dirname, "../public"),       // one level up
      path.resolve(__dirname, "public"),          // same level
      path.resolve(process.cwd(), "public"),      // cwd/public (local dev)
    ];

    let publicDir = null;
    for (const dir of candidates) {
      if (fs.existsSync(dir)) { publicDir = dir; break; }
    }

    if (!publicDir) {
      return res.status(404).json({ ok: false, error: "public/ directory not found" });
    }

    const files = fs.readdirSync(publicDir).filter(f =>
      f.toLowerCase().startsWith("a-spec") && f.toLowerCase().endsWith(".xlsx")
    );

    if (files.length === 0) {
      return res.status(404).json({ ok: false, error: "No A-SPEC xlsx files found in public/" });
    }

    // Extract YYYYMMDD from filename for sorting; fall back to mtime
    const datePattern = /(\d{8})/;
    const scored = files.map(f => {
      const match = f.match(datePattern);
      const score = match
        ? parseInt(match[1], 10)
        : fs.statSync(path.join(publicDir, f)).mtimeMs;
      return { f, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const latest = scored[0].f;

    return res.status(200).json({ ok: true, filename: latest });
  } catch (err) {
    console.error("master-codelist scan error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

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