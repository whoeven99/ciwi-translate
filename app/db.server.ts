// 远程 Turso 走 HTTP 客户端
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createRequire } from "node:module";
import path from "node:path";
import type { PrismaClient as PrismaClientType } from "./generated/prisma";
import { libsqlFetch } from "./config/libsqlFetch.server";
import { ensureRuntimeEnv, describeTursoEnvKeys } from "./config/runtimeEnv.server";
import { readTursoCredentials } from "./config/tursoTarget.server";

// 最早执行：支持本地 .env 与 Render Secret File（/etc/secrets/.env 等）
ensureRuntimeEnv();

const require = createRequire(import.meta.url);
const prismaClientModulePath = path.resolve(process.cwd(), "app/generated/prisma");
const { PrismaClient } = (() => {
  try {
    return require(prismaClientModulePath) as {
      PrismaClient: typeof PrismaClientType;
    };
  } catch {
    return require("./generated/prisma") as {
      PrismaClient: typeof PrismaClientType;
    };
  }
})();

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClientType | undefined;
}

function tursoUrlHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(invalid-url)";
  }
}

function createTursoPrismaClient(): PrismaClientType {
  const { url, authToken, urlKey, tokenKey } = readTursoCredentials();

  if (!url.startsWith("libsql://")) {
    throw new Error(
      [
        `请设置有效的 ${urlKey}，例如 "libsql://xxx.turso.io"。`,
        describeTursoEnvKeys(),
        "本地：仓库根目录 .env；Render：各服务 Environment 或 Secret File。",
      ].join(" "),
    );
  }

  if (!authToken) {
    throw new Error(`请设置 ${tokenKey}。${describeTursoEnvKeys()}`);
  }

  console.info(`[Turso] Prisma host=${tursoUrlHost(url)} key=${urlKey}`);

  const adapter = new PrismaLibSQL({ url, authToken, fetch: libsqlFetch });
  return new PrismaClient({ adapter });
}

if (!global.prismaGlobal) {
  global.prismaGlobal = createTursoPrismaClient();
}

const prisma = global.prismaGlobal;

export default prisma;
