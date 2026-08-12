import prisma from "~/db.server";
import {
  PICTURE_CDN_URL,
  PICTURE_COS_URL,
  uploadImageBuffer,
  uploadImageFromUrl,
} from "./cos.server";
import { type BaseResponse } from "~/server/storefront/response.server";
import { invalidateStorefrontCache } from "~/server/storefront/cache.server";

export { PICTURE_CDN_URL, PICTURE_COS_URL };

/** 对齐 Java UserPicturesDO / Jackson camelCase，供 Admin + ciwi 使用。 */
export type UserPicturePayload = {
  id: number;
  shopName: string;
  imageId: string;
  imageBeforeUrl: string;
  imageAfterUrl: string | null;
  altBeforeTranslation: string | null;
  altAfterTranslation: string | null;
  languageCode: string;
  isDelete: boolean;
};

export type UserPictureWriteInput = {
  shop: string;
  imageId: string;
  imageBeforeUrl: string;
  languageCode: string;
  imageAfterUrl?: string | null;
  altBeforeTranslation?: string | null;
  altAfterTranslation?: string | null;
};

function ok<T>(response: T): BaseResponse<T> {
  return { success: true, errorCode: 0, errorMsg: "", response };
}

function fail<T>(response: T, errorMsg = "SERVER_ERROR"): BaseResponse<T> {
  return { success: false, errorCode: 10001, errorMsg, response };
}

export function toCdnImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(PICTURE_COS_URL, PICTURE_CDN_URL);
}

function toPayload(row: {
  id: number;
  shop: string;
  imageId: string;
  imageBeforeUrl: string;
  imageAfterUrl: string | null;
  altBeforeTranslation: string | null;
  altAfterTranslation: string | null;
  languageCode: string;
  isDelete: boolean;
}): UserPicturePayload {
  return {
    id: row.id,
    shopName: row.shop,
    imageId: row.imageId,
    imageBeforeUrl: row.imageBeforeUrl,
    imageAfterUrl: toCdnImageUrl(row.imageAfterUrl),
    altBeforeTranslation: row.altBeforeTranslation,
    altAfterTranslation: row.altAfterTranslation,
    languageCode: row.languageCode,
    isDelete: row.isDelete,
  };
}

async function nextUserPictureId(): Promise<number> {
  const agg = await prisma.userPicture.aggregate({ _max: { id: true } });
  return (agg._max.id ?? 0) + 1;
}

/** 按产品 GID + 语言读未删除图译记录。 */
export async function listProductPictures(args: {
  shop: string;
  imageId: string;
  languageCode: string;
}): Promise<UserPicturePayload[]> {
  const rows = await prisma.userPicture.findMany({
    where: {
      shop: args.shop,
      imageId: args.imageId,
      languageCode: args.languageCode,
      isDelete: false,
    },
  });
  return rows.map(toPayload);
}

/** 按店铺 + 语言读未删除图译记录。 */
export async function listShopPictures(args: {
  shop: string;
  languageCode: string;
}): Promise<UserPicturePayload[]> {
  const rows = await prisma.userPicture.findMany({
    where: {
      shop: args.shop,
      languageCode: args.languageCode,
      isDelete: false,
    },
  });
  return rows.map(toPayload);
}

export async function getProductPictures(args: {
  shop: string;
  imageId: string;
  languageCode: string;
}): Promise<BaseResponse<UserPicturePayload[]>> {
  try {
    return ok(await listProductPictures(args));
  } catch (err) {
    console.error(`[picture] product read failed shop=${args.shop}:`, err);
    return fail([], "SERVER_ERROR");
  }
}

export async function getShopPictures(args: {
  shop: string;
  languageCode: string;
}): Promise<BaseResponse<UserPicturePayload[]>> {
  try {
    return ok(await listShopPictures(args));
  } catch (err) {
    console.error(`[picture] shop read failed shop=${args.shop}:`, err);
    return fail([], "SERVER_ERROR");
  }
}

/**
 * Upsert 图译元数据（对齐 Spring insertPictureData）。
 * 含软删行也会复活并更新，避免复合唯一键冲突。
 */
export async function upsertUserPicture(
  input: UserPictureWriteInput,
): Promise<BaseResponse<UserPicturePayload>> {
  try {
    const existing = await prisma.userPicture.findUnique({
      where: {
        shop_imageId_imageBeforeUrl_languageCode: {
          shop: input.shop,
          imageId: input.imageId,
          imageBeforeUrl: input.imageBeforeUrl,
          languageCode: input.languageCode,
        },
      },
    });

    if (existing) {
      const updated = await prisma.userPicture.update({
        where: { id: existing.id },
        data: {
          isDelete: false,
          ...(input.imageAfterUrl !== undefined
            ? { imageAfterUrl: input.imageAfterUrl }
            : {}),
          ...(input.altBeforeTranslation !== undefined
            ? { altBeforeTranslation: input.altBeforeTranslation }
            : {}),
          ...(input.altAfterTranslation !== undefined
            ? { altAfterTranslation: input.altAfterTranslation }
            : {}),
        },
      });
      await invalidateStorefrontCache("picture", input.shop);
      return ok(toPayload(updated));
    }

    const created = await prisma.userPicture.create({
      data: {
        id: await nextUserPictureId(),
        shop: input.shop,
        imageId: input.imageId,
        imageBeforeUrl: input.imageBeforeUrl,
        languageCode: input.languageCode,
        imageAfterUrl: input.imageAfterUrl ?? null,
        altBeforeTranslation: input.altBeforeTranslation ?? null,
        altAfterTranslation: input.altAfterTranslation ?? null,
        isDelete: false,
      },
    });
    await invalidateStorefrontCache("picture", input.shop);
    return ok(toPayload(created));
  } catch (err) {
    console.error(`[picture] upsert failed shop=${input.shop}:`, err);
    return fail(null as unknown as UserPicturePayload, "SERVER_ERROR");
  }
}

export async function softDeleteUserPicture(args: {
  shop: string;
  imageId: string;
  imageBeforeUrl: string;
  languageCode: string;
}): Promise<BaseResponse<UserPicturePayload | null>> {
  try {
    const existing = await prisma.userPicture.findUnique({
      where: {
        shop_imageId_imageBeforeUrl_languageCode: {
          shop: args.shop,
          imageId: args.imageId,
          imageBeforeUrl: args.imageBeforeUrl,
          languageCode: args.languageCode,
        },
      },
    });
    if (!existing) {
      return fail(null, "NOT_FOUND");
    }
    const updated = await prisma.userPicture.update({
      where: { id: existing.id },
      data: { isDelete: true },
    });
    await invalidateStorefrontCache("picture", args.shop);
    return ok(toPayload(updated));
  } catch (err) {
    console.error(`[picture] delete failed shop=${args.shop}:`, err);
    return fail(null, "SERVER_ERROR");
  }
}

/** 上传文件到 COS 并 upsert（手动上传）。 */
export async function uploadAndUpsertUserPicture(args: {
  shop: string;
  imageId: string;
  imageBeforeUrl: string;
  languageCode: string;
  file: {
    buffer: Buffer;
    contentType: string;
    filename?: string;
  };
  altBeforeTranslation?: string | null;
  altAfterTranslation?: string | null;
}): Promise<BaseResponse<UserPicturePayload>> {
  try {
    const imageAfterUrl = await uploadImageBuffer({
      shop: args.shop,
      imageId: args.imageId,
      buffer: args.file.buffer,
      contentType: args.file.contentType,
      filename: args.file.filename,
    });
    return upsertUserPicture({
      shop: args.shop,
      imageId: args.imageId,
      imageBeforeUrl: args.imageBeforeUrl,
      languageCode: args.languageCode,
      imageAfterUrl,
      altBeforeTranslation: args.altBeforeTranslation ?? "",
      altAfterTranslation: args.altAfterTranslation ?? "",
    });
  } catch (err) {
    console.error(`[picture] uploadAndUpsert failed shop=${args.shop}:`, err);
    return fail(
      null as unknown as UserPicturePayload,
      err instanceof Error ? err.message : "SERVER_ERROR",
    );
  }
}

/** 从译后临时 URL 落 COS + upsert（图译第二步）。 */
export async function saveTranslatedImageFromUrl(args: {
  shop: string;
  imageUrl: string;
  userPicture: {
    imageId: string;
    imageBeforeUrl: string;
    languageCode: string;
    altBeforeTranslation?: string | null;
    altAfterTranslation?: string | null;
  };
}): Promise<BaseResponse<UserPicturePayload>> {
  try {
    const imageAfterUrl = await uploadImageFromUrl({
      shop: args.shop,
      imageId: args.userPicture.imageId,
      imageUrl: args.imageUrl,
    });
    return upsertUserPicture({
      shop: args.shop,
      imageId: args.userPicture.imageId,
      imageBeforeUrl: args.userPicture.imageBeforeUrl,
      languageCode: args.userPicture.languageCode,
      imageAfterUrl,
      altBeforeTranslation: args.userPicture.altBeforeTranslation ?? "",
      altAfterTranslation: args.userPicture.altAfterTranslation ?? "",
    });
  } catch (err) {
    console.error(`[picture] saveFromUrl failed shop=${args.shop}:`, err);
    return fail(
      null as unknown as UserPicturePayload,
      err instanceof Error ? err.message : "SERVER_ERROR",
    );
  }
}

export { ok as pictureOk, fail as pictureFail };
