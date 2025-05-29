const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

const GEMINI_CONFIG = {
  API_KEY: process.env.GEMINI_API_KEY || 'AIzaSyBsQnaUc2IwbtUIQa9maEQ5jGU0BZD1oXc',
  MODEL_NAME: 'gemini-2.0-flash-exp-image-generation',
  RATE_LIMIT: 2, // requests per second
  MAX_RETRIES: 3,
  IMAGE_OUTPUT_DIR: path.join(__dirname, '../../public/generated_images')
};

const genAI = new GoogleGenerativeAI(GEMINI_CONFIG.API_KEY);
const firestore = admin.firestore();

const getArticlesForImageGeneration = async () => {
  try {
    const snapshot = await firestore
      .collection('news_articles')
      .where('image_generated', '==', false)
      .where('image_prompts', '!=', null)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error fetching articles:', error);
    throw error;
  }
};

const ensureArticleImageDir = (articleId) => {
  const articleDir = path.join(GEMINI_CONFIG.IMAGE_OUTPUT_DIR, articleId);
  if (!fs.existsSync(articleDir)) {
    fs.mkdirSync(articleDir, { recursive: true });
  }
  return articleDir;
};

const generateAndSaveImage = async (prompt, outputPath, retries = GEMINI_CONFIG.MAX_RETRIES) => {
  const cacheKey = `image_${prompt.substring(0, 400)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_CONFIG.MODEL_NAME });

    const safePrompt = `${prompt}
      - Photorealistic style
      - Culturally appropriate for Nepal
      - No violence, weapons or sensitive content
      - 9:16 aspect ratio
      - High detail and quality`;

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: safePrompt }]
      }],
      generationConfig: {
        responseModalities: ['Text', 'Image']
      }
    });

    const response = await result.response;
    const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

    if (!imagePart?.inlineData?.data) {
      throw new Error('No image data received from Gemini');
    }

    const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
    fs.writeFileSync(outputPath, buffer);

    const webPath = outputPath.replace(/^.*public/, '');
    cache.set(cacheKey, webPath);
    return webPath;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Retrying image generation (${retries} left): ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * (GEMINI_CONFIG.MAX_RETRIES - retries + 1)));
      return generateAndSaveImage(prompt, outputPath, retries - 1);
    }
    throw error;
  }
};

const processArticleImages = async (article) => {
  const articleDir = ensureArticleImageDir(article.uuid);
  const imageResults = [];

  for (const [index, promptObj] of article.image_prompts.entries()) {
    try {
      const imageName = `image_${index + 1}.png`;
      const imagePath = path.join(articleDir, imageName);
      const webPath = await generateAndSaveImage(promptObj.prompt, imagePath);

      imageResults.push({
        url: webPath,
      });

      console.log(`Generated image ${index + 1}/${article.image_prompts.length} for article ${article.uuid}`);

      // Rate limiting between image generations
      if (index < article.image_prompts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (error) {
      console.error(`Failed to generate image ${index + 1} for article ${article.uuid}: ${error.message}`);
      imageResults.push({
        prompt: promptObj.prompt,
        aspect: promptObj.aspect,
        error: error.message,
        generated_at: new Date().toISOString()
      });
    }
  }

  return imageResults;
};

const updateArticleWithImages = async (articleId, imageUrls) => {
  await firestore.collection('news_articles').doc(articleId).update({
    image_urls: imageUrls,
    image_generated: true,
    firebase_updated_at: admin.firestore.FieldValue.serverTimestamp()
  });
};

const generateImagesForArticles = async (maxArticles = 5) => {
  try {
    const articles = await getArticlesForImageGeneration();
    if (articles.length === 0) {
      console.log('No articles found needing image generation');
      return [];
    }

    const processedArticles = [];
    for (const article of articles.slice(0, maxArticles)) {
      try {
        const imageUrls = await processArticleImages(article);
        await updateArticleWithImages(article.id, imageUrls);

        processedArticles.push({
          id: article.id,
          uuid: article.uuid,
          image_count: imageUrls.filter(img => img.url).length,
          failed_count: imageUrls.filter(img => img.error).length
        });

        console.log(`Completed images for article ${article.uuid}`);
      } catch (error) {
        console.error(`Failed to process article ${article.uuid}: ${error.message}`);
      }
    }

    console.log(`Successfully processed ${processedArticles.length} articles`);
    return processedArticles;
  } catch (error) {
    console.error('Image generation process failed:', error);
    throw error;
  }
};

module.exports = {
  generateImagesForArticles,
  // For testing/monitoring
  _private: {
    getArticlesForImageGeneration,
    generateAndSaveImage,
    processArticleImages
  }
};