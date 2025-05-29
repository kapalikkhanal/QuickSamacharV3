import {
  Img,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { Helmet } from "react-helmet";
import "../../public/global.css";
import audioFile from "../../public/audio/audio.mp3";

export const VideoBackground = ({ videoData }) => {
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();

  // Calculate total available time for images based on audio duration
  const totalAvailableTime = durationInFrames / fps;
  const imageCount = videoData.imageUrls?.length || 1;

  // Adjust image display time to fit within audio duration
  const calculatedDisplayTime = Math.min(
    videoData.image_display_time || 2.5,
    totalAvailableTime / imageCount
  );

  // console.error(JSON.stringify(videoData, null, 2));

  // Configuration
  //   const IMAGE_DISPLAY_TIME = videoData?.image_display_time ?? 2.5;
  //   const TRANSITION_DURATION = videoData?.transition_duration ?? 0.5;
  const IMAGE_DISPLAY_TIME = Math.max(calculatedDisplayTime, 1.5); // Minimum 1.5s per image
  const TRANSITION_DURATION = Math.min(
    videoData.transition_duration || 0.5,
    IMAGE_DISPLAY_TIME * 0.3
  );
  const ZOOM_INTENSITY = videoData?.zoom_intensity ?? 0.05;

  // console.error("Data is:", IMAGE_DISPLAY_TIME, TRANSITION_DURATION, ZOOM_INTENSITY)

  // Get images array and filter out null/invalid URLs
  let rawImagesArray = videoData?.imageUrls || videoData?.imageUrl || [];
  if (!Array.isArray(rawImagesArray) && rawImagesArray) {
    rawImagesArray = [rawImagesArray]; // Convert single image to array
  } else if (!Array.isArray(rawImagesArray)) {
    rawImagesArray = [];
  }

  // Filter out null/invalid URLs
  const imagesArray = rawImagesArray.filter((image) => {
    if (!image) return false;
    const url = typeof image === "string" ? image : image?.url;
    return !!url; // Keep only truthy URLs
  });

  // Early return if no valid images
  if (imagesArray.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          backgroundColor: "#333", // Default gray background instead of black
          position: "relative",
        }}
      >
        {/* Render news content without background images */}
        {renderNewsContent(videoData, width, height)}
      </div>
    );
  }

  // Timing calculations
  const totalFramesPerImage = IMAGE_DISPLAY_TIME * fps;
  const transitionFrames = TRANSITION_DURATION * fps;

  // Ensure images loop throughout the entire video duration
  const totalCycles = Math.ceil(
    durationInFrames / (totalFramesPerImage * imagesArray.length)
  );
  const totalFrames = totalFramesPerImage * imagesArray.length * totalCycles;

  // Use modulo to ensure continuous looping regardless of video length
  const adjustedFrame = frame % totalFrames;
  const currentImageIndex =
    Math.floor(adjustedFrame / totalFramesPerImage) % imagesArray.length;
  const nextImageIndex = (currentImageIndex + 1) % imagesArray.length;

  // Progress calculations with smoother easing
  const currentFrameInSegment = adjustedFrame % totalFramesPerImage;

  // Use easing for smoother transition
  const transitionProgress = interpolate(
    currentFrameInSegment,
    [totalFramesPerImage - transitionFrames, totalFramesPerImage],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => {
        // Custom ease-in-out function for smoother transitions
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      },
    }
  );

  // Ken Burns effect calculations with smoother interpolation
  const kenBurnsScale = interpolate(
    currentFrameInSegment,
    [0, totalFramesPerImage],
    [1, 1 + ZOOM_INTENSITY],
    {
      easing: (t) => {
        // More gentle easing for slower perceived zoom
        return t * (1 - Math.sin(t * Math.PI * 0.5) * 0.3);
      },
    }
  );

  // Use different easing for X and Y movements to create more natural motion
  const kenBurnsX = interpolate(
    currentFrameInSegment,
    [0, totalFramesPerImage],
    [0, 25],
    {
      easing: (t) => Math.sin((t * Math.PI) / 2),
    }
  );

  const kenBurnsY = interpolate(
    currentFrameInSegment,
    [0, totalFramesPerImage],
    [0, 15],
    {
      easing: (t) => t * (2 - t),
    }
  );

  // Helper function to safely get image URL
  const getImageUrl = (index) => {
    if (index < 0 || index >= imagesArray.length) return null;
    const image = imagesArray[index];
    if (!image) return null;

    let url = typeof image === "string" ? image : image?.url;
    return url ? `/${url.replace(/^(\.?\/)/, "")}` : null;
  };

  const currentImageUrl = getImageUrl(currentImageIndex);
  const nextImageUrl = getImageUrl(nextImageIndex);

  // Calculate random direction for each image to add variety
  const getDirectionMultiplier = (index) => {
    return (index * 13) % 2 === 0 ? 1 : -1;
  };

  const currentDirection = getDirectionMultiplier(currentImageIndex);
  const nextDirection = getDirectionMultiplier(nextImageIndex);

  return (
    <div style={{ position: "relative", width, height, overflow: "hidden" }}>
      <Helmet>
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;600&family=Noto+Sans+Devanagari:wght@500&display=swap"
          rel="stylesheet"
        />
      </Helmet>

      <Audio
        src={staticFile(
          `/${videoData.audioPath?.replace(/^(\.?\/)/, "") || ""}`
        )}
        volume={videoData.volume}
      />

      <Audio src={audioFile} volume={0.05} />

      {/* Current Image with Ken Burns Effect */}
      {currentImageUrl && (
        <div
          style={{
            position: "absolute",
            width: "120%",
            height: "120%",
            left: "-10%",
            top: "-10%",
            transform: `scale(${kenBurnsScale}) translate(${
              kenBurnsX * currentDirection
            }px, ${kenBurnsY * currentDirection}px)`,
            opacity: 1 - transitionProgress,
            zIndex: 10,
            filter: "brightness(0.92) saturate(1.1)",
            willChange: "transform, opacity",
          }}
        >
          <Img
            src={staticFile(currentImageUrl)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>
      )}

      {/* Next Image with Inverse Ken Burns Effect */}
      {nextImageUrl && (
        <div
          style={{
            position: "absolute",
            width: "120%",
            height: "120%",
            left: "-10%",
            top: "-10%",
            // Start with the end state of the next image and move toward its beginning state
            transform: `scale(${
              1 + ZOOM_INTENSITY - ZOOM_INTENSITY * transitionProgress
            }) 
                               translate(${
                                 25 * nextDirection * (1 - transitionProgress)
                               }px, 
                                         ${
                                           15 *
                                           nextDirection *
                                           (1 - transitionProgress)
                                         }px)`,
            opacity: transitionProgress,
            zIndex: 11,
            filter: "brightness(0.92) saturate(1.1)",
            willChange: "transform, opacity",
          }}
        >
          <Img
            src={staticFile(nextImageUrl)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>
      )}

      {renderNewsContent(videoData, width, height)}
    </div>
  );
};

// Helper function to render news content (extracted to avoid duplication)
const renderNewsContent = (videoData, width, height) => {
  return (
    <div>
      {/* Broadcast Overlay Elements */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height,
          background: "/images/noise.png",
          mixBlendMode: "soft-light",
          opacity: 0.1,
          zIndex: 20,
        }}
      />

      {/* News Content Area */}
      <div
        style={{
          position: "absolute",
          bottom: 220,
          left: 80,
          right: 80,
          zIndex: 25,
          color: "white",
          maxWidth: "80%",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            borderLeft: "4px solid #FF4655",
            paddingLeft: 32,
            paddingRight: 120,
            background:
              "linear-gradient(to right, rgba(20,20,20,0.7) 0%, rgba(20,20,20,0.1) 85%, transparent 100%)",
            backdropFilter: "blur(8px)",
            borderRadius: 8,
            padding: "32px 40px",
            boxShadow:
              "0 12px 24px rgba(0,0,0,0.3), inset: -20px 0 30px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <span
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 20,
                color: "rgba(255,255,255,0.8)",
              }}
            >
              {new Date().toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>

          <h1
            style={{
              fontSize: 52,
              margin: 0,
              fontFamily: "'Playfair Display', serif",
              fontWeight: 700,
              lineHeight: 1.5,
              letterSpacing: "-0.8px",
              textShadow: "1px 2px 4px rgba(0,0,0,0.3)",
            }}
          >
            {videoData?.title || "Breaking News"}
          </h1>

          <p
            style={{
              fontSize: 32,
              fontFamily: "'Inter', sans-serif",
              lineHeight: 1.4,
              fontWeight: 400,
              opacity: 0.95,
              marginTop: 28,
            }}
          >
            {videoData?.content || "News generation error."}
          </p>
        </div>
      </div>

      {/* Breaking News Ticker */}
      <div
        style={{
          position: "absolute",
          top: 220,
          right: 40,
          zIndex: 30,
          background: "linear-gradient(90deg, #FF4655 0%, #D13446 100%)",
          padding: "14px 40px",
          borderRadius: 6,
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          style={{ flexShrink: 0 }}
        >
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
            fill="white"
          />
        </svg>
        <span
          style={{
            color: "white",
            fontSize: 24,
            fontWeight: 600,
            fontFamily: "'Inter', sans-serif",
            letterSpacing: 0.8,
            whiteSpace: "nowrap",
          }}
        >
          BREAKING NEWS • AI VISUALS
        </span>
      </div>

      {/* Lower Third Banner */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "rgba(10,10,10,0.95)",
          padding: "20px 80px",
          borderTop: "3px solid #FF4655",
          zIndex: 30,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "rgba(255,255,255,0.9)",
          }}
        >
          <span
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            {videoData?.source || "Quick Samachar"}
          </span>
          <div style={{ display: "flex", gap: 40 }}>
            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 16 }}>
              {new Date().toLocaleTimeString()}
            </span>
            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 16 }}>
              © {new Date().getFullYear()} All Rights Reserved
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
