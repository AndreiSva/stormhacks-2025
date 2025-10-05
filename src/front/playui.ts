document.addEventListener("playerhit", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  const timeDiv = document.getElementById("time");
  const livesDiv = document.getElementById("lives");

  if (livesDiv) {
    livesDiv.textContent = `Lives: ${detail.remainingLives}`;
  }
  if (timeDiv) {
    timeDiv.textContent = `Time: ${Math.floor(detail.time / 1000)}s`;
  }
});

document.addEventListener("playerSurvive100meteres", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  const timeDiv = document.getElementById("time");

  if (timeDiv) {
    timeDiv.textContent = `Time: ${Math.floor(detail.time / 1000)}s`;
  }
});

document.addEventListener("playerdies", (e: Event) => {
  const detail = (e as CustomEvent).detail;
  console.log("Game Over!", detail);

  // Show game over screen
  alert(`Game Over! Time: ${Math.floor(detail.time / 1000)}s`);
});
