const express = require("express");
const cors = require("cors");
const path = require("path");
const compression = require("compression");
const NodeCache = require("node-cache");

const SessionManager = require("../sessions");
const TrashManager = require("../trash");
const FirebaseClient = require("../firebase-client");

const createApiRoutes = require("../routes/api");
const createSseRoute = require("../routes/sse");

const app = express();

const cache = new NodeCache({ stdTTL: 30, checkperiod: 60 });

app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionManager = new SessionManager();
const trashManager = new TrashManager();

let firebase;

try {
  firebase = new FirebaseClient();
} catch (error) {
  console.error("Firebase init failed:", error.message);
}

app.use("/api", createApiRoutes(sessionManager, trashManager, firebase, cache));

app.use("/sse", createSseRoute(sessionManager, firebase, cache));

app.use(express.static(path.join(process.cwd(), "public")));

module.exports = app;