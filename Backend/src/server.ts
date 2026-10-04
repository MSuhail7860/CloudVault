import app from "./app.js";
import { env } from "./config/env.js";

app.listen(env.PORT, () => {
  console.log(`CloudVault API running on port ${env.PORT}`);
});