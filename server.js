const { scrapeNews } = require("./components/news_scraper/server");
const {
  generateImagesForArticles,
} = require("./components/image_generator/server");
const {
  generateAudioForArticles,
} = require("./components/audio_generator/server");
const { renderVideo } = require("./modules/remotion/render");
const {
  getArticlesWithoutVideo,
  updateVideoStatus,
  getVideoUploadStatus,
} = require("./components/firebase_store/server");
const { PostToTiktok, getTiktokCookies } = require("./modules/tiktok/tiktok");
const {
  PostToInstagram,
  getInstagramCookies,
} = require("./modules/instagram/instagram");
const { execSync } = require("child_process");
const fs = require("fs");
const express = require("express");
const path = require("path");
const cron = require("node-cron");
const { rimraf } = require("rimraf");

const app = express();

// Configure static directories
app.use(
  "/generated_images",
  express.static(path.join(__dirname, "public/generated_images"))
);
app.use(
  "/generated_audio",
  express.static(path.join(__dirname, "public/generated_audio"))
);
app.use(
  "/generated_video",
  express.static(path.join(__dirname, "public/generated_video"))
);
app.use("/public", express.static(path.join(__dirname, "public")));

// Ensure video output directory exists
const VIDEO_OUTPUT_DIR = path.join(__dirname, "public/generated_video");
if (!fs.existsSync(VIDEO_OUTPUT_DIR)) {
  fs.mkdirSync(VIDEO_OUTPUT_DIR, { recursive: true });
}

async function generateVideos(maxVideos = 3) {
  try {
    console.log("Starting video generation pipeline...");

    // 1. Get articles needing video generation
    const articles = await getArticlesWithoutVideo();

    if (articles.length === 0) {
      console.log("No articles found needing video generation");
      return [];
    }

    console.log(`Found ${articles.length} articles needing video generation`);

    const results = [];
    for (const article of articles.slice(0, maxVideos)) {
      try {
        console.log(`\nProcessing article: ${article.paraphrased_title}`);
        console.log(`Article UUID: ${article.uuid}`);

        // 2. Validate required fields
        if (!article.image_urls?.length || !article.audio_path) {
          console.warn(
            "Skipping article - missing required media (images or audio)"
          );
          continue;
        }

        // 3. Create article-specific video directory
        const articleVideoDir = path.join(VIDEO_OUTPUT_DIR, article.uuid);
        if (!fs.existsSync(articleVideoDir)) {
          fs.mkdirSync(articleVideoDir, { recursive: true });
        }

        // 4. Generate video filename
        const timestamp = new Date().toISOString();
        const videoFilename = `${timestamp}.mp4`;
        const videoPath = path.join(articleVideoDir, videoFilename);
        const webVideoPath = `/generated_video/${article.uuid}/${videoFilename}`;

        // 5. Render video using Remotion
        console.log("Starting video rendering...");
        await renderVideo({
          title: article.paraphrased_title,
          content: article.paraphrased_content,
          imageUrls: article.image_urls
            .filter((img) => img.url)
            .map((img) => img.url),
          audioPath: article.audio_path,
          outputPath: videoPath,
          durationPerImage: 8,
          volume: 0.9,
          imageDisplayTime: 4,
          transitionDuration: 0.5,
          zoomIntensity: 0.04,
        });

        console.log(`Video successfully rendered: ${videoPath}`);

        results.push({
          success: true,
          articleId: article.uuid,
          videoPath: webVideoPath,
          socialPosted: true,
        });

      } catch (error) {
        console.error(`Failed to process article ${article.uuid}:`, error);
        results.push({
          success: false,
          articleId: article.uuid,
          error: error.message,
        });
      }

      // Add delay between video generations
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    console.log(
      `\nVideo generation completed. Success: ${
        results.filter((r) => r.success).length
      }/${results.length}`
    );
    return results;
  } catch (error) {
    console.error("Error in video generation pipeline:", error);
    throw error;
  }
}

async function postVideos() {
  try {
    console.log("Video posting has started.");

    const articles = await getVideoUploadStatus();

    if (articles.length === 0) {
      console.log("No articles found needing video generation");
      return [];
    }

    console.log(
      `Found ${articles.length} articles needing posting on social media.`
    );

    for (const article of articles) {
      try {
        console.log(`Article UUID: ${article.uuid}`);

        const videoPath = article.video_path;
        const hashtags = Array.isArray(article.captions)
          ? article.captions
          : ["#nepal", "#news", "#nepalinews"];
        const content = article.paraphrased_content;

        try {
          await PostToTiktok(videoPath, content, hashtags);
          console.log("Successfully posted to TikTok");
          await updateVideoStatus(article.uuid);

          // 4. Cleanup generated files
          try {
            const articleId = article.uuid;
            const pathsToClean = [
              path.join(process.cwd(), "public", "generated_images", articleId),
              path.join(process.cwd(), "public", "generated_audio", articleId),
              path.join(process.cwd(), "public", "generated_video", articleId),
            ];

            console.log("Cleaning up generated files...");
            await Promise.all(
              pathsToClean.map(async (path) => {
                if (fs.existsSync(path)) {
                  await rimraf(path);
                  console.log(`Deleted: ${path}`);
                }
              })
            );
          } catch (cleanupError) {
            console.error("Cleanup failed:", cleanupError);
          }
        } catch (socialError) {
          console.error("Failed to post to social media:", socialError);
        }

        console.log("Firestore updated with video status");
      } catch (error) {
        console.error(`Failed to process article ${article.uuid}:`, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } catch (error) {
    console.error("Error posting videos:", error);
    throw error;
  }
}

async function main() {
  try {
    await scrapeNews();
    await generateImagesForArticles();
    await generateAudioForArticles();

    await generateVideos();
    await postVideos();

    // Uncomment to login and save cookies (one-time setup)
    // await getTiktokCookies('https://www.tiktok.com/login', 'tiktok')

    console.log("Application workflow completed successfully");
  } catch (error) {
    console.error("Error in main application workflow:", error);
  }
}

function setupCronJobs() {
  // Scrape and process news every 2 hours
  cron.schedule("0 */2 * * *", async () => {
    console.log("\nRunning scheduled news scraping...");
    try {
      await main();
      console.log("Scheduled news scraping completed");
    } catch (error) {
      console.error("Error in scheduled news scraping:", error);
    }
  });
}

// Initialize application
(async () => {
  // Run immediate workflow
  await main();

  // Setup scheduled tasks
  setupCronJobs();
})();

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
