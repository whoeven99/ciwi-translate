import {
  buildSwitcherEditDefaults,
  type SwitcherEditData,
} from "~/lib/switcherConstants";

export type { SwitcherEditData } from "~/lib/switcherConstants";
export { buildSwitcherEditDefaults };

type SwitcherApiResponse = {
  success: boolean;
  errorCode?: number | null;
  errorMsg?: string | null;
  response?: SwitcherEditData;
};

async function parseSwitcherApiResponse(
  response: Response,
): Promise<SwitcherApiResponse> {
  try {
    const data = (await response.json()) as Partial<SwitcherApiResponse>;
    if (typeof data?.success === "boolean") {
      return {
        success: data.success,
        errorCode: data.errorCode ?? null,
        errorMsg: data.errorMsg ?? null,
        response: data.response,
      };
    }
  } catch {}

  return {
    success: false,
    errorCode: response.status || null,
    errorMsg: response.statusText || null,
    response: undefined,
  };
}

/** 读配置：全量 v4，走 Turso。 */
export async function loadSwitcherConfigCompat(_args: {
  migrated?: boolean;
  shop: string;
  signal?: AbortSignal;
}): Promise<SwitcherApiResponse> {
  try {
    const res = await fetch("/api/translate-v4/switcher", {
      signal: _args.signal,
    });
    return await parseSwitcherApiResponse(res);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return {
      success: false,
      errorCode: null,
      errorMsg: null,
      response: undefined,
    };
  }
}

/** 保存配置：全量 v4，写 Turso。 */
export async function saveSwitcherConfigCompat(args: {
  migrated?: boolean;
  shop?: string;
  data: SwitcherEditData;
}): Promise<SwitcherApiResponse> {
  try {
    const res = await fetch("/api/translate-v4/switcher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args.data),
    });
    return await parseSwitcherApiResponse(res);
  } catch {
    return {
      success: false,
      errorCode: null,
      errorMsg: null,
      response: undefined,
    };
  }
}
