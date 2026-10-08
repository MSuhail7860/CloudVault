import express from "express";
import cors from "cors";
import v1Router from "./routes/v1/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    message: "CloudVault API is running",
  });
});

app.use("/api/v1", v1Router);

app.use(notFound);
app.use(errorHandler);

export default app;