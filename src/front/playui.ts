let gameStartTime = 0;
// Tune detection UI management
let tuneDetectionActive = false;
let lastDetectedNote = "";
let lastDetectedAction = "";

document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("start-game-btn");
  const loadingScreen = document.getElementById("loading-screen");
  const gameContainer = document.getElementById("game-container");
  const violinIcon = document.querySelector(".violin-icon") as HTMLElement;
  const loadingDots = document.querySelector(".loading-dots") as HTMLElement;
  const loadingSubtitle = document.querySelector(".loading-subtitle") as HTMLElement;

  // Stop animations after 2 seconds and show checkmark + button
  setTimeout(() => {
    if (violinIcon) {
      violinIcon.style.animation = "none";
    }
    if (loadingDots) {
      loadingDots.querySelectorAll("span").forEach((dot) => {
        (dot as HTMLElement).style.animation = "none";
      });
    }

    // Show green checkmark
    if (loadingSubtitle) {
      loadingSubtitle.innerHTML = '<span style="color: #10b981; font-size: 2rem;">✓</span> Ready for Takeoff';
      loadingSubtitle.style.color = "#10b981";
    }

    // Show start button
    if (startBtn) {
      startBtn.style.display = "block";
    }
  }, 1500);

  if (startBtn && loadingScreen && gameContainer) {
    startBtn.addEventListener("click", () => {
      startBtn.textContent = "Loading...";
      gameStartTime = performance.now();

      // Fade out loading screen
      loadingScreen.style.transition = "opacity 0.4s ease";
      loadingScreen.style.opacity = "0";

      setTimeout(() => {
        loadingScreen.style.display = "none";
        gameContainer.style.display = "block";

        // Fade in game
        gameContainer.style.opacity = "0";
        gameContainer.style.transition = "opacity 0.4s ease";
        requestAnimationFrame(() => {
          gameContainer.style.opacity = "1";
        });

        // Signal game to start
        document.dispatchEvent(new CustomEvent("startgame"));
      }, 400);
    });
  }
});

// Function to show game over modal
function showGameOverModal(finalTime: number) {
  const modal = document.getElementById("game-over-modal");
  const finalTimeElement = document.getElementById("final-time");
  const gameContainer = document.getElementById("game-container");

  if (modal && finalTimeElement) {
    finalTimeElement.textContent = `${finalTime}s`;

    if (gameContainer) {
      gameContainer.style.transition = "opacity 0.4s ease";
      gameContainer.style.opacity = "0";

      // Wait for fade to complete, then hide and show modal
      setTimeout(() => {
        gameContainer.style.display = "none";
        modal.style.display = "flex";
      }, 400);
    } else {
      // If gameContainer doesn't exist, just show modal immediately
      modal.style.display = "flex";
    }
  }
}

// Function to handle player death
function handlePlayerDeath(time: number) {
  const elapsedSeconds = Math.floor((time - gameStartTime) / 1000);

  // Show modal instead of alert
  setTimeout(() => {
    showGameOverModal(elapsedSeconds);
  }, 100);
}

// Make endGame available globally
(window as any).endGame = function () {
  // Call the function directly instead of dispatching event
  handlePlayerDeath(performance.now());
};

// Make tune detection UI functions available globally
(window as any).updateTuneDetectionUI = function (note: string, action: string) {
  lastDetectedNote = note;
  lastDetectedAction = action;

  const noteElement = document.getElementById("detected-note");
  const actionElement = document.getElementById("detected-action");

  if (noteElement && actionElement) {
    noteElement.textContent = note;
    actionElement.textContent = action;
  }
};

(window as any).setTuneDetectionStatus = function (active: boolean) {
  tuneDetectionActive = active;
  const hud = document.getElementById("tune-detector-hud");
  const statusText = document.getElementById("tune-status-text");
  const detectionInfo = document.querySelector(".tune-detection-info") as HTMLElement;

  if (hud && statusText && detectionInfo) {
    if (active) {
      hud.classList.add("active");
      statusText.textContent = "ON";
      detectionInfo.style.display = "block";
    } else {
      hud.classList.remove("active");
      statusText.textContent = "OFF";
      detectionInfo.style.display = "none";
    }
  }
};

document.addEventListener("playerhit", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  const livesDiv = document.getElementById("lives");
  if (livesDiv) {
    livesDiv.textContent = `Lives: ${detail.remainingLives}`;
  }
});

document.addEventListener("playerSurvive100meteres", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  const timeDiv = document.getElementById("time");
  if (timeDiv) {
    const elapsedSeconds = Math.floor((detail.time - gameStartTime) / 1000);
    timeDiv.textContent = `Time: ${elapsedSeconds}s`;
  }
});

document.addEventListener("playerdies", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  handlePlayerDeath(detail.time);
});
