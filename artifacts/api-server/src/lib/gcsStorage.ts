import { objectStorageClient } from "./objectStorage";
import { Readable } from "stream";

function getBucketId(): string {
  const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucketId) {
    throw new Error(
      "DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set. Provision Object Storage first."
    );
  }
  return bucketId;
}

export async function uploadSchemaPdf(
  slotName: string,
  buffer: Buffer
): Promise<string> {
  const bucketId = getBucketId();
  const objectName = `schemas/${slotName}.pdf`;
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectName);

  await file.save(buffer, { contentType: "application/pdf", resumable: false });

  return objectName;
}

export async function streamSchemaPdf(
  objectPath: string
): Promise<Readable | null> {
  const bucketId = getBucketId();
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);

  const [exists] = await file.exists();
  if (!exists) return null;

  return file.createReadStream();
}

export async function deleteSchemaPdf(objectPath: string): Promise<void> {
  const bucketId = getBucketId();
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);
  const [exists] = await file.exists();
  if (exists) {
    await file.delete();
  }
}

export async function getSchemaPdfMetadata(
  objectPath: string
): Promise<{ size: number | null } | null> {
  const bucketId = getBucketId();
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);

  const [exists] = await file.exists();
  if (!exists) return null;

  const [meta] = await file.getMetadata();
  return { size: meta.size ? Number(meta.size) : null };
}
