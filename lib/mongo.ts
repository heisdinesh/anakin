import { MongoClient, Db } from "mongodb";
import { getEnvValue } from "@/lib/env";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getMongoDb(): Promise<Db> {
  if (cachedDb) return cachedDb;

  const uri = await getEnvValue("MONGO_URI");
  if (!uri) {
    throw new Error("Missing MONGO_URI in .env.local or .env");
  }

  const client = new MongoClient(uri);
  await client.connect();

  cachedClient = client;
  cachedDb = client.db("trackleaf_pulse");
  return cachedDb;
}

export function getMongoClient() {
  return cachedClient;
}
