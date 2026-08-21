import express from "express";
import cors from "cors";
import session from "express-session";
import bcrypt from "bcryptjs";

import {
  buildPlanForHub,
  applyPlanForHub,
} from "./agent.js";

const app = express();


// ======================================================
// REQUIRED ENVIRONMENT VARIABLES
// ======================================================

if (
  !process.env.CODEASE_USERNAME ||
  !process.env.CODEASE_PASSWORD_HASH ||
  !process.env.SESSION_SECRET
) {
  throw new Error(
    "Missing CodEase authentication environment variables."
  );
}


// ======================================================
// BASIC SERVER SETUP
// ======================================================

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json());


// ======================================================
// SESSION SETUP
// ======================================================

app.use(
  session({
    secret:
      process.env.SESSION_SECRET,

    resave:
      false,

    saveUninitialized:
      false,

    cookie: {
      httpOnly:
        true,

      sameSite:
        "lax",

      secure:
        false,

      maxAge:
        1000 *
        60 *
        60 *
        8,
    },
  })
);


// ======================================================
// AUTHENTICATION HELPER
// ======================================================

function requireAuth(
  req,
  res,
  next
) {
  if (
    req.session?.authenticated
  ) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: "Authentication required.",
  });
}


// ======================================================
// LOGIN STATUS
// ======================================================

app.get(
  "/api/auth/status",
  (req, res) => {

    res.json({
      success: true,

      authenticated:
        Boolean(
          req.session?.authenticated
        ),
    });
  }
);


// ======================================================
// LOGIN
// ======================================================

app.post(
  "/api/login",
  async (req, res) => {

    try {

      const {
        username,
        password,
      } = req.body;


      if (
        !username ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Username and password are required.",
        });
      }


      const usernameMatches =
        username ===
        process.env.CODEASE_USERNAME;


      if (!usernameMatches) {
        return res.status(401).json({
          success: false,
          error:
            "Invalid username or password.",
        });
      }


      const passwordMatches =
        await bcrypt.compare(
          password,
          process.env
            .CODEASE_PASSWORD_HASH
        );


      if (!passwordMatches) {
        return res.status(401).json({
          success: false,
          error:
            "Invalid username or password.",
        });
      }


      req.session.regenerate(
        (error) => {

          if (error) {
            return res.status(500).json({
              success: false,
              error:
                "Could not create login session.",
            });
          }


          req.session.authenticated =
            true;


          req.session.save(
            (saveError) => {

              if (saveError) {
                return res.status(500).json({
                  success: false,
                  error:
                    "Could not save login session.",
                });
              }


              res.json({
                success: true,
                message:
                  "Login successful.",
              });
            }
          );
        }
      );

    } catch (error) {

      res.status(500).json({
        success: false,
        error:
          "Login failed.",
      });
    }
  }
);


// ======================================================
// LOGOUT
// ======================================================

app.post(
  "/api/logout",
  (req, res) => {

    req.session.destroy(
      (error) => {

        if (error) {
          return res.status(500).json({
            success: false,
            error:
              "Could not log out.",
          });
        }


        res.clearCookie(
          "connect.sid"
        );


        res.json({
          success: true,
          message:
            "Logged out successfully.",
        });
      }
    );
  }
);


// ======================================================
// PLAN ENDPOINT
// ======================================================

app.post(
  "/api/plan",
  requireAuth,
  async (req, res) => {

    const {
      hub,
      request,
    } = req.body;


    if (
      !hub ||
      !request
    ) {
      return res.status(400).json({
        success: false,
        error:
          "hub and request are required.",
      });
    }


    try {

      const result =
        await buildPlanForHub({
          hubId:
            hub,

          staffRequest:
            request,
        });


      res.json({
        success:
          true,

        hub:
          result.hub,

        repo:
          result.repo,

        baseBranch:
          result.baseBranch,

        plan:
          result.plan,
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        error:
          error.message,
      });
    }
  }
);


// ======================================================
// APPLY ENDPOINT
// ======================================================

app.post(
  "/api/apply",
  requireAuth,
  async (req, res) => {

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
          hubId:
            hub,

          staffRequest:
            request,

          plan,
        });


      res.json({
        success:
          true,

        hub:
          result.hub,

        repo:
          result.repo,

        prNumber:
          result.prNumber,

        messages:
          result.messages,
      });

    } catch (error) {

      res.status(500).json({
        success: false,
        error:
          error.message,
      });
    }
  }
);


// ======================================================
// FRONTEND
// ======================================================

app.use(
  express.static(
    "public"
  )
);


// ======================================================
// START SERVER
// ======================================================

const PORT =
  process.env.PORT ||
  3000;


app.listen(
  PORT,
  () => {

    console.log(
      `CodEase server running on http://localhost:${PORT}`
    );
  }
);
