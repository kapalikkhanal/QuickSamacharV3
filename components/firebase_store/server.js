const admin = require("firebase-admin");
require("dotenv").config();
const { v4: uuidv4 } = require("uuid");

let firestore;

try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  firestore = admin.firestore();
  console.log("Firebase Admin SDK initialized successfully");
} catch (error) {
  console.log("Failed to initialize Firebase Admin SDK:", error);
  process.exit(1);
}

const ARTICLES_COLLECTION = "news_articles";
const BATCH_SIZE = 500;

async function storeArticles(articles) {
  if (!Array.isArray(articles) || articles.length === 0) {
    console.log("No articles provided or invalid format");
    return {
      success: false,
      message: "No articles provided or invalid format",
      storedCount: 0,
    };
  }

  try {
    const collectionRef = firestore.collection(ARTICLES_COLLECTION);
    // console.log("collectionRef", collectionRef);
    let storedCount = 0;

    // Process in batches to avoid hitting Firestore limits
    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = firestore.batch();
      const batchArticles = articles.slice(i, i + BATCH_SIZE);

      batchArticles.forEach((article) => {
        const docId = uuidv4();
        const docRef = collectionRef.doc(docId);

        // Prepare article data with timestamps
        const { image_prompts, article_index, ...filteredArticle } = article;
        const articleData = {
          uuid: docId,
          ...filteredArticle,
          image_prompts: image_prompts,
          firebase_created_at: admin.firestore.FieldValue.serverTimestamp(),
          firebase_updated_at: admin.firestore.FieldValue.serverTimestamp(),
        };

        batch.set(docRef, articleData, { merge: true });
      });

      await batch.commit();
      storedCount += batchArticles.length;
      console.log(
        `Stored batch of ${batchArticles.length} articles (total: ${storedCount})`
      );
    }

    return {
      success: true,
      message: `Successfully stored ${storedCount} articles`,
      storedCount,
    };
  } catch (error) {
    console.log("Error storing articles:", error);
    return {
      success: false,
      message: `Failed to store articles: ${error.message}`,
      storedCount: 0,
    };
  }
}

async function articleExists(link) {
  try {
    const snapshot = await firestore
      .collection(ARTICLES_COLLECTION)
      .where("link", "==", link)
      .limit(1)
      .get();

    return !snapshot.empty;
  } catch (error) {
    console.log("Error checking article existence:", error);
    return false;
  }
}

async function getArticlesWithoutVideo() {
  const snapshot = await firestore
    .collection(ARTICLES_COLLECTION)
    .where("video_generated", "==", false)
    .get();

  return snapshot.docs.map((doc) => doc.data());
}

async function getVideoUploadStatus() {
  const snapshot = await firestore
    .collection(ARTICLES_COLLECTION)
    .where("upload_status", "==", false)
    .get();

  return snapshot.docs.map((doc) => doc.data());
}

async function updateVideoStatus(articleId, videoPath, uploadStatus = true) {
  if (videoPath) {
    await firestore.collection(ARTICLES_COLLECTION).doc(`${articleId}`).update({
      video_generated: true,
      video_path: videoPath,
      video_generated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  if (uploadStatus) {
    await firestore.collection(ARTICLES_COLLECTION).doc(`${articleId}`).update({
      upload_status: true,
    });
  }
}

module.exports = {
  storeArticles,
  articleExists,
  getArticlesWithoutVideo,
  getVideoUploadStatus,
  updateVideoStatus,
};
