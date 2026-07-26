import dotenv from "dotenv";

dotenv.config({ override: true });
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { getServerConfig } from "./config.js";
import "./db.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerInterpretRoutes } from "./routes/interpret.js";

const fastify = Fastify({ logger: true });

await fastify.register(cookie, {
  secret: process.env.COOKIE_SECRET || "dev-cookie-secret-change-me",
});

fastify.get("/health", async () => ({ ok: true }));

await registerApiRoutes(fastify);
await registerFileRoutes(fastify);
await registerInterpretRoutes(fastify);

const serverCfg = getServerConfig();

await fastify.register(fastifyStatic, {
  root: serverCfg.publicDir,
  prefix: "/",
});

await fastify.listen({ port: serverCfg.port, host: serverCfg.host });
