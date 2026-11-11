import { existsSync } from "node:fs";
import dotenv from "dotenv";

if (existsSync(".env")) dotenv.config();
