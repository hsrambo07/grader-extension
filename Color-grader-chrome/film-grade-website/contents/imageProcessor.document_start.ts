// Early initialization script - runs before page content loads
// This is a special version that runs at document_start

const DEBUG_MODE = true;

// Flag to track if we've started processing
let processingStarted = false;

// Create a global namespace object to ensure functions survive minification
(function setupGlobalFunctions() {
  try {
    // Create the namespace if it doesn't exist
    if (typeof window.FilmGradeExt === 'undefined') {
      window.FilmGradeExt = {
        callCount: 0,
        earlyInit: true
      };
    } else {
      window.FilmGradeExt.earlyInit = true;
    }
    console.log('Film Grade: Early initialization setup complete');
  } catch (e) {
    console.error("Film Grade: Failed to setup global functions", e);
  }
})();

// Helper to conditionally log messages only in debug mode
const debugLog = (message: string, ...args: any[]) => {
  if (DEBUG_MODE) {
    console.log(`Film Grade: ${message}`, ...args);
  }
};

// Helper to conditionally log errors
const debugError = (message: string, ...args: any[]) => {
  if (DEBUG_MODE) {
    console.error(`Film Grade: ${message}`, ...args);
  }
};

// Define constants for our data attributes
const PROCESSED_ATTRIBUTE = 'data-film-grade-original-src';
const PROCESSING_ATTRIBUTE = 'data-film-grade-processing';

// Setup loading styles immediately
const setupLoadingStyles = () => {
  if (!document.getElementById('film-grade-styles')) {
    const style = document.createElement('style');
    style.id = 'film-grade-styles';
    style.textContent = `
      [${PROCESSING_ATTRIBUTE}="true"] {
        position: relative !important;
        z-index: 1 !important;
      }
      [${PROCESSING_ATTRIBUTE}="true"]::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.3);
        z-index: 9999;
        pointer-events: none;
      }
      [${PROCESSING_ATTRIBUTE}="true"]::after {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        width: 30px;
        height: 30px;
        margin: -15px 0 0 -15px;
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top: 3px solid #fff;
        border-radius: 50%;
        z-index: 10000;
        animation: filmGradeSpinner 1s linear infinite;
        pointer-events: none;
      }
      @keyframes filmGradeSpinner {
        to {transform: rotate(360deg);}
      }
    `;
    document.head.appendChild(style);
  }
};

// Apply styles immediately
if (document.head) {
  setupLoadingStyles();
} else {
  // If head is not available yet, wait for it
  const observer = new MutationObserver((mutations, obs) => {
    if (document.head) {
      setupLoadingStyles();
      obs.disconnect();
    }
  });
  
  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true
  });
}

// Helper function to get settings
const getFilterSettings = async (): Promise<{ preset: string, enableGrain: boolean, enableVignette: boolean, isEnabled: boolean }> => {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { preset: 'none', enableGrain: false, enableVignette: false, isEnabled: true },
      (items) => {
        resolve(items as { preset: string, enableGrain: boolean, enableVignette: boolean, isEnabled: boolean });
      }
    );
  });
};

// Preload LUTs to make them available immediately when needed
const preloadLUTs = async () => {
  debugLog('Preloading LUTs...');
  const settings = await getFilterSettings();
  
  if (settings.isEnabled && settings.preset !== 'none') {
    try {
      const lutUrl = chrome.runtime.getURL(`assets/luts/${settings.preset}.cube`);
      fetch(lutUrl)
        .then(response => response.text())
        .then(lutText => {
          window.FilmGradeExt.preloadedLUT = lutText;
          debugLog(`Preloaded LUT for ${settings.preset}`);
        })
        .catch(err => {
          debugError('Failed to preload LUT', err);
        });
    } catch (err) {
      debugError('Error preloading LUTs', err);
    }
  }
};

// Start preloading
preloadLUTs();

// Create early observer to start processing images immediately as they appear in the DOM
const createEarlyObserver = async () => {
  debugLog('Setting up early observer...');
  
  try {
    const settings = await getFilterSettings();
    
    if (!settings.isEnabled || settings.preset === 'none') {
      debugLog('Extension disabled or no preset selected, skipping early observer');
      return;
    }
    
    debugLog(`Early observer using preset: ${settings.preset}`);
    
    // Create observer to watch for images being added to the DOM
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of Array.from(mutation.addedNodes)) {
            // Check if the node is an image element
            if (node instanceof HTMLImageElement) {
              const img = node as HTMLImageElement;
              
              // Check if the image has loaded or is still loading
              if (img.complete) {
                debugLog('Found complete image, marking for processing');
                // Mark this image so the main processor knows to process it immediately
                img.dataset.filmGradeEarlyDetect = 'true';
              } else {
                debugLog('Found loading image, setting up load listener');
                // Set up a load event listener
                img.addEventListener('load', () => {
                  debugLog('Image loaded, marking for processing');
                  img.dataset.filmGradeEarlyDetect = 'true';
                }, { once: true });
              }
            } 
            // Also look for images within added nodes
            else if (node instanceof HTMLElement) {
              const images = (node as HTMLElement).querySelectorAll('img');
              images.forEach(img => {
                if (img.complete) {
                  img.dataset.filmGradeEarlyDetect = 'true';
                } else {
                  img.addEventListener('load', () => {
                    img.dataset.filmGradeEarlyDetect = 'true';
                  }, { once: true });
                }
              });
            }
          }
        }
      }
    });
    
    // Start observing document
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true
    });
    
    // Store observer reference for potential cleanup
    window.FilmGradeExt.earlyObserver = observer;
    
    debugLog('Early observer setup complete');
  } catch (err) {
    debugError('Error setting up early observer', err);
  }
};

// Start the early observer
createEarlyObserver();

// Listen for interactive state to prepare for handoff to main processor
document.addEventListener('readystatechange', () => {
  debugLog(`Document readyState changed to: ${document.readyState}`);
  
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    // If images were marked by our early observer, make sure that information is accessible to main processor
    if (window.FilmGradeExt.earlyObserver) {
      debugLog('Document interactive, preparing for handoff to main processor');
      
      // We can keep the early observer running to catch dynamically added elements
      // The main processor will handle the initially marked elements
    }
  }
});

// Make sure we also listen for window load event as a backup
window.addEventListener('load', () => {
  debugLog('Window load event fired');
});

// Export a function that main processor can call to check if we're alive
export const isDocumentStartActive = () => true;

// Add to global namespace
if (window.FilmGradeExt) {
  window.FilmGradeExt.documentStartActive = true;
}

debugLog('document_start initialization complete');
