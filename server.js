import express from "express";
import cors from "cors";

import {
  buildPlanForHub,
  applyPlanForHub,
} from "./agent.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("CodEase backend is running.");
});


// ======================================================
// PLAN ENDPOINT
// ======================================================

app.post("/api/plan", async (req, res) => {
  const { hub, request } = req.body;

  if (!hub || !request) {
    return res.status(400).json({
      success: false,
      error: "hub and request are required.",
    });
  }

  try {
    const result =
      await buildPlanForHub({
        hubId: hub,
        staffRequest: request,
      });

    res.json({
      success: true,
      hub: result.hub,
      repo: result.repo,
      baseBranch: result.baseBranch,
      plan: result.plan,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


// ======================================================
// APPLY ENDPOINT
// ======================================================

app.post("/api/apply", async (req, res) => {
  const {
    hub,
    request,
    plan,
  } = req.body;

  if (
    !hub ||
    !request ||
    !plan
  ) {
    return res.status(400).json({
      success: false,
      error:
        "hub, request, and plan are required.",
    });
  }

  try {
    const result =
      await applyPlanForHub({
        hubId: hub,
        staffRequest: request,
        plan,
      });

    res.json({
      success: true,
      hub: result.hub,
      repo: result.repo,
      prNumber: result.prNumber,
      messages: result.messages,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


const PORT = 3000;

app.listen(PORT, () => {
  console.log(
    `CodEase server running on http://localhost:${PORT}`
  );
});