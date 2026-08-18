import COS from "cos-nodejs-sdk-v5";

export const PICTURE_COS_URL =
  "https://ciwi-us-1327177217.cos.na-ashburn.myqcloud.com";
export const PICTURE_CDN_URL = "https://img.bogdatech.com";

const BUCKET = "ciwi-us-1327177217";
const REGION = "na-ashburn";
const PATH_PREFIX = "image-Translation";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/gif",
]);

function getCosClient(): COS {
  const secretId =
    process.env.TENCENT_COS_SECRET_ID ||
    process.env.TENCENT_BUCKET_SECRET_ID ||
    "";
  const secretKey =
    process.env.TENCENT_COS_SECRET_KEY ||
    process.env.TENCENT_BUCKET_SECRET_KEY ||
    "";
  if (!secretId || !secretKey) {
    throw new Error(
      "Missing TENCENT_COS_SECRET_ID / TENCENT_COS_SECRET_KEY (or TENCENT_BUCKET_*)",
    );
  }
  return new COS({ SecretId: secretId, SecretKey: secretKey });
}

function random8(): string {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

function extensionFromName(filename: string | undefined, mime: string): string {
  if (filename && filename.includes(".")) {
    return filename.slice(filename.lastIndexOf("."));
  }
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/heic":
      return ".heic";
    default:
      return ".jpg";
  }
}

function putObject(args: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<string> {
  const cos = getCosClient();
  return new Promise((resolve, reject) => {
    cos.putObject(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key: args.key,
        Body: args.body,
        ContentType: args.contentType,
      },
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(`${PICTURE_COS_URL}/${args.key}`);
      },
    );
  });
}

export function assertAllowedImageMime(mime: string | undefined): string {
  const type = (mime || "").toLowerCase();
  if (!ALLOWED_MIME.has(type)) {
    throw new Error("Image format error");
  }
  return type === "image/jpg" ? "image/jpeg" : type;
}

/** 上传文件到 COS，返回 COS 直链（与 Spring HunYuanBucketIntegration 路径规则一致）。 */
export async function uploadImageBuffer(args: {
  shop: string;
  imageId: string;
  buffer: Buffer;
  contentType: string;
  filename?: string;
}): Promise<string> {
  const contentType = assertAllowedImageMime(args.contentType);
  const ext = extensionFromName(args.filename, contentType);
  const key = `${PATH_PREFIX}/${args.shop}/${args.imageId}/${random8()}${ext}`;
  return putObject({ key, body: args.buffer, contentType });
}

export function toCdnImageUrl(url: string): string {
  return url.replace(PICTURE_COS_URL, PICTURE_CDN_URL);
}

/** 客服聊天图片：support-chat/{shop}/{id}.ext → CDN URL。 */
export async function uploadSupportChatImage(args: {
  shop: string;
  buffer: Buffer;
  contentType: string;
  filename?: string;
}): Promise<string> {
  const contentType = assertAllowedImageMime(args.contentType);
  const ext = extensionFromName(args.filename, contentType);
  const id = `${Date.now().toString(36)}${random8()}`;
  const key = `support-chat/${args.shop}/${id}${ext}`;
  const cosUrl = await putObject({ key, body: args.buffer, contentType });
  return toCdnImageUrl(cosUrl);
}

/** 从临时 URL 下载再上传 COS（图译第二步）。 */
export async function uploadImageFromUrl(args: {
  shop: string;
  imageId: string;
  imageUrl: string;
}): Promise<string> {
  const res = await fetch(args.imageUrl);
  if (!res.ok) {
    throw new Error(`download image failed: HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  const urlPath = new URL(args.imageUrl).pathname;
  const filename = urlPath.slice(urlPath.lastIndexOf("/") + 1) || "image.jpg";
  return uploadImageBuffer({
    shop: args.shop,
    imageId: args.imageId,
    buffer,
    contentType,
    filename,
  });
}
