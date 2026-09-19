import { Firestore } from "@google-cloud/firestore";

let database;
const memoryFallback = [];

function db() {
  database ||= new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT, ignoreUndefinedProperties: true });
  return database;
}

function summary(id, result) {
  return {
    id,
    topic: result.topic,
    generatedAt: result.generatedAt,
    stats: result.stats,
    summary: result.analysis?.summary || "",
    conditions: result.conditions || {}
  };
}

export async function saveResearch(result) {
  try {
    const ref = await db().collection("research_history").add(result);
    const overflow = await db().collection("research_history").orderBy("generatedAt", "desc").offset(100).get();
    if (!overflow.empty) {
      const batch = db().batch();
      overflow.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    return ref.id;
  } catch (error) {
    console.warn("Firestore history unavailable; using temporary memory:", error.message);
    const id = `temporary-${Date.now()}`;
    memoryFallback.unshift({ id, ...result });
    memoryFallback.splice(100);
    return id;
  }
}

export async function listResearch(limit = 100) {
  try {
    const snapshot = await db().collection("research_history").orderBy("generatedAt", "desc").limit(limit).get();
    return snapshot.docs.map(doc => summary(doc.id, doc.data()));
  } catch (error) {
    console.warn("Firestore history read unavailable:", error.message);
    return memoryFallback.slice(0, limit).map(item => summary(item.id, item));
  }
}

export async function getResearch(id) {
  if (id.startsWith("temporary-")) return memoryFallback.find(item => item.id === id) || null;
  try {
    const doc = await db().collection("research_history").doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (error) {
    console.warn("Firestore history item unavailable:", error.message);
    return null;
  }
}
