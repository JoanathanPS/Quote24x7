import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Checking buckets...");
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.error("Error listing buckets:", listErr);
  } else {
    console.log("Buckets:", buckets.map((b) => b.name));
  }

  const bucketName = "benchmark-datasets";
  const existing = buckets?.find((b) => b.name === bucketName || b.id === bucketName);

  if (!existing) {
    console.log(`Creating public bucket '${bucketName}'...`);
    const { data: createData, error: createErr } = await supabase.storage.createBucket(bucketName, {
      public: true,
    });
    if (createErr) {
      console.warn("Could not create bucket:", createErr.message);
    } else {
      console.log("Bucket created:", createData);
    }
  }

  // Upload benchmark-dataset-v1.json
  const filePath = path.resolve(process.cwd(), "benchmark-dataset-v1.json");
  const fileContent = fs.readFileSync(filePath);

  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from(bucketName)
    .upload("benchmark-dataset-v1.json", fileContent, {
      contentType: "application/json",
      upsert: true,
    });

  if (uploadErr) {
    console.error("Upload failed:", uploadErr);
  } else {
    console.log("Upload success:", uploadData);
    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl("benchmark-dataset-v1.json");
    console.log("Public URL:", publicUrlData?.publicUrl);
  }
}

run();
