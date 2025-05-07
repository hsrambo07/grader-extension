// Add a debug mode flag at the top of the file
const DEBUG_MODE = true; // Set to true to help troubleshoot the current issues

// Create a global namespace object to ensure functions survive minification
(function setupGlobalFunctions() {
  try {
    // Create the namespace if it doesn't exist
    if (typeof window.FilmGradeExt === 'undefined') {
      window.FilmGradeExt = {
        callCount: 0
      };
    }
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

// Helper to conditionally log errors only in debug mode or if critical
const debugError = (message: string, ...args: any[]) => {
  if (DEBUG_MODE) {
    console.error(`Film Grade: ${message}`, ...args);
  }
};

const PROCESSED_ATTRIBUTE = 'data-film-grade-original-src';
const PROCESSING_ATTRIBUTE = 'data-film-grade-processing';

// Setup loading styles moved to top of file to avoid initialization errors
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

// Helper function to check if an element is an SVG or vector
const isSVGorVector = (element: HTMLElement): boolean => {
  if (element.tagName === 'svg') return true;
  if (element.tagName === 'path') return true;
  
  // Check if it has an SVG parent
  let parent = element.parentElement;
  while (parent) {
    if (parent.tagName === 'svg') return true;
    parent = parent.parentElement;
  }
  
  return false;
};

// Helper to load an image with crossorigin="anonymous"
const loadImageCrossOrigin = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('Image source is empty.'));
      return;
    }
    
    // Function to try loading via the extension's background script as proxy
    const tryLoadViaProxy = () => {
      // Use the extension's messaging to request image data from background
      chrome.runtime.sendMessage(
        { action: 'proxyImage', imageUrl: src },
        (response) => {
          if (chrome.runtime.lastError) {
            debugError('Error requesting image proxy', chrome.runtime.lastError);
            reject(new Error(`Failed to proxy image: ${chrome.runtime.lastError.message}`));
            return;
          }
          
          if (response && response.success && response.dataUrl) {
            // Create a new image from the data URL
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load proxied image data URL'));
            img.src = response.dataUrl;
          } else {
            reject(new Error('Failed to get proxied image data'));
          }
        }
      );
    };
    
    // First try the regular way with crossOrigin
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    // Set a timeout to detect if CORS is taking too long (likely blocked)
    const corsTimeout = setTimeout(() => {
      debugLog('CORS timeout, trying fallback methods');
      // If this is a remote image (not extension or data URL), try proxy
      if (src.startsWith('http') && !src.startsWith(chrome.runtime.getURL(''))) {
        tryLoadViaProxy();
      } else {
        // For local resources, try without crossOrigin
        const nonCorsImg = new Image();
        nonCorsImg.onload = () => {
          debugLog('Loaded image without CORS');
          resolve(nonCorsImg);
        };
        nonCorsImg.onerror = (err) => {
          debugError('All image loading methods failed', err);
          reject(new Error(`Failed to load image: ${src}`));
        };
        nonCorsImg.src = src;
      }
    }, 3000); // 3 second timeout for CORS
    
    img.onload = () => {
      clearTimeout(corsTimeout);
      resolve(img);
    };
    
    img.onerror = (err) => {
      clearTimeout(corsTimeout);
      debugLog('CORS error, trying fallback methods immediately');
      
      // If this is a remote image (not extension or data URL), try proxy
      if (src.startsWith('http') && !src.startsWith(chrome.runtime.getURL(''))) {
        tryLoadViaProxy();
      } else {
        // For local resources, try without crossOrigin
        const nonCorsImg = new Image();
        nonCorsImg.onload = () => {
          debugLog('Loaded image without CORS');
          resolve(nonCorsImg);
        };
        nonCorsImg.onerror = (err) => {
          debugError('All image loading methods failed', err);
          reject(new Error(`Failed to load image: ${src}`));
        };
        nonCorsImg.src = src;
      }
    };
    
    try {
      img.src = src;
    } catch (e) {
      clearTimeout(corsTimeout);
      debugError('Error setting img.src', e);
      reject(new Error(`Error setting img.src: ${e.message}`));
    }
  });
};

// Add optimization flags to control how aggressive the extension is
const CONFIG = {
  // Maximum number of images to process in one page
  MAX_IMAGES_TO_PROCESS: 150, // Reduced from 200
  // Skip images smaller than this size (width or height in pixels)
  MIN_IMAGE_SIZE: 30, // Increased from 40 to further avoid tiny icons/elements
  // Process images larger than this size last (width or height in pixels)
  LARGE_IMAGE_SIZE: 200, // Increased slightly
  // Maximum canvas size to prevent memory issues
  MAX_CANVAS_DIMENSION: 3840, // Slightly reduced, common 4K dimension
  // Batch size for processing
  BATCH_SIZE: 6, // Reduced for potentially faster UI updates between batches
  // Batch delay between batches (ms)
  BATCH_DELAY: 150, // Reduced from 250ms for quicker succession of batches
  // How frequently to check for new content (ms)
  CONTENT_CHECK_INTERVAL: 10000, // Increased from 8s to 10s, less frequent checks
  // Viewport expansion for detection (px beyond viewport)
  VIEWPORT_EXPANSION: 4000, // Reduced from 800px, more focused on near-viewport
  // Continuous processing enabled 
  ENABLE_CONTINUOUS_PROCESSING: false, // Kept false by default
  // Debug display for unprocessed images
  DEBUG_UNPROCESSED: false, 
  // Debug mode
  DEBUG: false, 
  // Max time to keep observers active (30s)
  MAX_OBSERVER_DURATION: 20 * 1000, // Reduced to 20 seconds
  // Maximum number of concurrent processing operations
  MAX_CONCURRENT: 4, 
  // Timeout for canceling stuck processing
  PROCESSING_TIMEOUT: 2500, // Reduced from 3000ms
  // Memory management: maximum URLs to keep in cache
  MAX_CACHE_SIZE: 300, // Reduced from 500
  // Auto clean cache when it reaches this threshold
  CACHE_CLEAN_THRESHOLD: 250 // Reduced from 400
};

let indicatorUpdateTimeout: NodeJS.Timeout | null = null;
const DEBOUNCE_INDICATOR_DELAY = 150; // ms

// Show/hide the global indicator
const updateGlobalIndicator = (visible: boolean, message: string = '') => {
  if (indicatorUpdateTimeout) {
    clearTimeout(indicatorUpdateTimeout);
  }
  indicatorUpdateTimeout = setTimeout(() => {
    const indicator = document.getElementById('film-grade-global-indicator') as HTMLElement | null;
    if (indicator) {
      if (visible) {
        indicator.style.display = 'block';
        indicator.textContent = message;
      } else {
        indicator.style.display = 'none';
      }
    }
    indicatorUpdateTimeout = null;
  }, DEBOUNCE_INDICATOR_DELAY);
};

// Cache for already processed URLs to avoid redundant work
const processedUrlCache = new Set<string>();

// Add cache management to prevent memory leaks
const cacheManager = {
  // Keep track of cache entries with timestamps
  entries: new Map<string, number>(),
  
  // Add an item to the cache with timestamp
  add(key: string): void {
    processedUrlCache.add(key);
    this.entries.set(key, Date.now());
    
    // Auto cleanup if we hit the threshold
    if (processedUrlCache.size > CONFIG.CACHE_CLEAN_THRESHOLD) {
      this.cleanup();
    }
  },
  
  // Check if an item exists in the cache
  has(key: string): boolean {
    return processedUrlCache.has(key);
  },
  
  // Remove an item from the cache
  delete(key: string): void {
    processedUrlCache.delete(key);
    this.entries.delete(key);
  },
  
  // Clean up oldest cache entries when we exceed the limit
  cleanup(): void {
    if (processedUrlCache.size <= CONFIG.MAX_CACHE_SIZE) {
      return; // No cleanup needed
    }
    
    // Convert to array and sort by timestamp (oldest first)
    const sortedEntries = Array.from(this.entries.entries())
      .sort((a, b) => a[1] - b[1]);
    
    // Calculate how many entries to remove
    const removeCount = processedUrlCache.size - CONFIG.MAX_CACHE_SIZE;
    
    // Remove oldest entries
    for (let i = 0; i < removeCount && i < sortedEntries.length; i++) {
      const key = sortedEntries[i][0];
      this.delete(key);
    }
    
    debugLog(`Cache cleaned up: removed ${removeCount} oldest entries`);
  },
  
  // Clear the entire cache
  clear(): void {
    processedUrlCache.clear();
    this.entries.clear();
    debugLog('Cache cleared');
  }
};

// Define the media elements result interface for better type safety
interface MediaElements {
  regular: HTMLElement[];
  large: HTMLElement[];
}

// Optimized findMediaElements with caching and reduced DOM queries
let mediaElementsCache: MediaElements | null = null;
let lastCacheTime: number = 0;
const CACHE_DURATION = 1000; // Cache results for 1 second

function findMediaElements(): MediaElements {
  const now = Date.now();
  if (mediaElementsCache && (now - lastCacheTime < CACHE_DURATION)) {
    debugLog('Using cached media elements');
    return mediaElementsCache;
  }

  try {
    if (window.FilmGradeExt) {
      window.FilmGradeExt.callCount = (window.FilmGradeExt.callCount || 0) + 1;
    }
    debugLog(`findMediaElements called (${window.FilmGradeExt?.callCount || 0})`);

    const regularElements: HTMLElement[] = [];
    const largeElements: HTMLElement[] = [];
    let imageCount = 0;
    const skippedImages = [];

    // Optimized selector combining img and picture img
    const images = document.querySelectorAll('img:not([data-film-grade-skip]), picture img:not([data-film-grade-skip])');

    images.forEach((img) => {
      const imgEl = img as HTMLImageElement;
      if (imageCount >= CONFIG.MAX_IMAGES_TO_PROCESS) {
        if (CONFIG.DEBUG_UNPROCESSED) skippedImages.push({ element: imgEl, reason: 'MAX_LIMIT' });
        return;
      }
      if (isSVGorVector(imgEl)) {
        if (CONFIG.DEBUG_UNPROCESSED) skippedImages.push({ element: imgEl, reason: 'SVG' });
        return;
      }

      const rect = imgEl.getBoundingClientRect();
      if (rect.width < CONFIG.MIN_IMAGE_SIZE || rect.height < CONFIG.MIN_IMAGE_SIZE) {
        if (CONFIG.DEBUG_UNPROCESSED) skippedImages.push({ element: imgEl, reason: 'TOO_SMALL', size: `${rect.width}x${rect.height}` });
        return;
      }

      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;
      const vertInView = (rect.top <= windowHeight + CONFIG.VIEWPORT_EXPANSION && rect.bottom >= -CONFIG.VIEWPORT_EXPANSION);
      const horInView = (rect.left <= windowWidth + CONFIG.VIEWPORT_EXPANSION && rect.right >= -CONFIG.VIEWPORT_EXPANSION);

      if (vertInView && horInView) {
        if (rect.width > CONFIG.LARGE_IMAGE_SIZE || rect.height > CONFIG.LARGE_IMAGE_SIZE) {
          largeElements.push(imgEl);
        } else {
          regularElements.push(imgEl);
        }
        imageCount++;
      } else {
        if (CONFIG.DEBUG_UNPROCESSED) skippedImages.push({ element: imgEl, reason: 'OUT_OF_VIEWPORT', position: `top:${rect.top}, left:${rect.left}`, viewport: `${windowWidth}x${windowHeight}` });
      }
    });

    // Optimized background image search
    if (imageCount < CONFIG.MAX_IMAGES_TO_PROCESS) {
      const bgSelector = 'div[style*="background-image"]:not([data-film-grade-skip]), section[style*="background-image"]:not([data-film-grade-skip]), article[style*="background-image"]:not([data-film-grade-skip]), figure[style*="background-image"]:not([data-film-grade-skip])';
      const bgContainers = document.querySelectorAll(bgSelector);

      bgContainers.forEach((el) => {
        if (imageCount >= CONFIG.MAX_IMAGES_TO_PROCESS) return;
        const element = el as HTMLElement;
        const style = window.getComputedStyle(element);
        if (style.backgroundImage && style.backgroundImage !== 'none' && !style.backgroundImage.includes('svg') &&
            !(style.backgroundImage.startsWith('url("data:image') && element.dataset.filmGradeOriginalSrc)) {
          const rect = element.getBoundingClientRect();
          const windowHeight = window.innerHeight;
          const windowWidth = window.innerWidth;
          const vertInView = (rect.top <= windowHeight + CONFIG.VIEWPORT_EXPANSION && rect.bottom >= -CONFIG.VIEWPORT_EXPANSION);
          const horInView = (rect.left <= windowWidth + CONFIG.VIEWPORT_EXPANSION && rect.right >= -CONFIG.VIEWPORT_EXPANSION);

          if (vertInView && horInView) {
            if (rect.width > CONFIG.LARGE_IMAGE_SIZE || rect.height > CONFIG.LARGE_IMAGE_SIZE) {
              largeElements.push(element);
            } else {
              regularElements.push(element);
            }
            imageCount++;
          }
        }
      });
    }

    if (CONFIG.DEBUG_UNPROCESSED && skippedImages.length > 0) {
      debugLog(`Skipped ${skippedImages.length} images:`);
      console.table(skippedImages.map(item => ({ reason: item.reason, src: item.element instanceof HTMLImageElement ? item.element.src.substring(0, 50) : 'background', size: item.size || `${item.element.clientWidth}x${item.element.clientHeight}`, position: item.position || '' })));
    }

    mediaElementsCache = { regular: regularElements, large: largeElements };
    lastCacheTime = now;
    debugLog(`findMediaElements found: ${regularElements.length} regular, ${largeElements.length} large`);
    if (window.FilmGradeExt) window.FilmGradeExt.lastResult = mediaElementsCache;
    return mediaElementsCache;
  } catch (e) {
    debugError("Error in findMediaElements", e);
    return { regular: [], large: [] };
  }
}

// Create a backward-compatible version that returns a flat array
// This will be our fallback for minified code
function findAllMediaElements(): HTMLElement[] {
  try {
    debugLog("findAllMediaElements called");
    
    // Try to use our globally stored value if available
    if (window.FilmGradeExt && window.FilmGradeExt.lastResult) {
      const result = window.FilmGradeExt.lastResult;
      debugLog("Using cached media elements result");
      return [...result.regular, ...result.large];
    }
    
    // Otherwise call the main function
    // Try to use the structured function first
    const result = findMediaElements();
    // Check if we got a valid result with arrays
    if (result && Array.isArray(result.regular) && Array.isArray(result.large)) {
      return [...result.regular, ...result.large];
    }
    
    throw new Error("findMediaElements returned invalid result");
  } catch (e) {
    debugError('Error in findAllMediaElements, using fallback', e);
    
    // Fallback implementation if the main function fails or returns unexpected format
    const elements: HTMLElement[] = [];
    
    try {
      // Find images directly
      const images = document.querySelectorAll('img:not([data-film-grade-processed])');
      images.forEach(img => {
        const imgEl = img as HTMLImageElement;
        if (imgEl.width >= CONFIG.MIN_IMAGE_SIZE && imgEl.height >= CONFIG.MIN_IMAGE_SIZE) {
          elements.push(imgEl);
        }
      });
      
      // Find background images directly
      const bgElements = document.querySelectorAll('div[style*="background-image"]:not([data-film-grade-processed])');
      bgElements.forEach(el => {
        elements.push(el as HTMLElement);
      });
      
      debugLog(`Fallback found ${elements.length} elements`);
    } catch (innerError) {
      debugError("Fallback search also failed", innerError);
    }
    
    return elements;
  }
}

// Make the function globally available to prevent bundler issues
// Store on both the window object AND our namespace for maximum compatibility
window.findMediaElements = findMediaElements;
window.findAllMediaElements = findAllMediaElements;

// Also store in our namespace
if (window.FilmGradeExt) {
  window.FilmGradeExt.findMediaElements = findMediaElements;
  window.FilmGradeExt.findAllMediaElements = findAllMediaElements;
  
  // Add direct access global functions that don't get renamed during minification
  window["__findMediaElements"] = findMediaElements;
  window["__findAllMediaElements"] = findAllMediaElements;
}

// Parse CUBE LUT files - Cache results for performance
const lutCache: Record<string, { size: number, data: number[][] }> = {};

const parseCubeLUT = (text: string, presetName: string) => {
  // Use cached LUT if available
  if (lutCache[presetName]) {
    return lutCache[presetName];
  }
  
  const lines = text.split('\n');
  const lut = { size: 0, data: [] as number[][] };
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }
    
    // Parse LUT size
    if (trimmed.startsWith('LUT_3D_SIZE')) {
      lut.size = parseInt(trimmed.split(/\s+/)[1], 10);
      continue;
    }
    
    // Parse RGB values
    const values = trimmed.split(/\s+/).map(Number);
    if (values.length === 3) {
      lut.data.push(values);
    }
  }
  
  // Cache the result
  lutCache[presetName] = lut;
  return lut;
};

// Apply LUT to image data
const applyCubeLUT = (imageData: ImageData, lut: { size: number, data: number[][] }) => {
  const { data, width, height } = imageData;
  const result = new ImageData(width, height);
  const resultData = result.data;
  
  // Get the max index to prevent out-of-bounds access
  const maxLutIndex = lut.data.length - 1;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    
    // Find closest LUT indices
    const size = lut.size;
    
    // Clamp indices to valid range to prevent out-of-bounds
    const x = Math.min(size - 1, Math.max(0, Math.floor(r * (size - 1)))); // R-index
    const y = Math.min(size - 1, Math.max(0, Math.floor(g * (size - 1)))); // G-index
    const z = Math.min(size - 1, Math.max(0, Math.floor(b * (size - 1)))); // B-index
    
    // Calculate index safely, ensuring we never exceed the array bounds
    let idx = z + y * size + x * size * size;
    idx = Math.min(maxLutIndex, Math.max(0, idx)); // Safely clamp within bounds
    
    // Apply LUT transformation (no need for bounds check anymore)
    resultData[i] = Math.round(lut.data[idx][0] * 255);
    resultData[i + 1] = Math.round(lut.data[idx][1] * 255);
    resultData[i + 2] = Math.round(lut.data[idx][2] * 255);
    resultData[i + 3] = data[i + 3]; // Keep original alpha
  }
  
  return result;
};

// Apply grain effect
const applyGrain = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, intensity: number = 0.1) => {
  if (intensity === 0) return; // Exit early if no grain to apply
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    // Generate random noise
    const noise = (Math.random() - 0.5) * intensity * 255;
    
    // Apply noise to RGB channels
    data[i] = Math.min(255, Math.max(0, data[i] + noise));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
  }
  
  ctx.putImageData(imageData, 0, 0);
};

// Apply vignette effect
const applyVignette = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, amount: number = 0.3) => {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.max(centerX, centerY) * 0.8;
  
  // Create radial gradient
  const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.7, centerX, centerY, radius);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, `rgba(0, 0, 0, ${amount})`);
  
  // Apply gradient
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
};

// Function to detect problematic sites that need special handling
const isProblematicSite = (): boolean => {
  const url = window.location.hostname.toLowerCase();
  
  // IMPORTANT: Medium.com is specifically excluded as our robust approach causes issues there
  if (url.includes('medium.com')) {
    return false;
  }
  
  // List of known problematic sites that need robust shadow DOM approach
  const problematicDomains = [
    'hackernoon.com',
    'dev.to',
    'react.dev',
    'github.com',
    'gitlab.com',
    'bitbucket.org',
    'npmjs.com',
    'yarnpkg.com',
    'exa.ai',
    'katestanislavska.com',
    'https://satabdi.framer.website/',
    
    // Add more as needed
  ];
  
  // Check if any of the domains match
  return problematicDomains.some(domain => url.includes(domain));
}

// Optimized image processing with reduced canvas operations and faster LUT application
const processImage = async (
  originalImgElement: HTMLImageElement,
  preset: string,
  enableGrain: boolean = false,
  enableVignette: boolean = false,
  forceReprocess: boolean = false
): Promise<void> => {
  if (!originalImgElement.src || (originalImgElement.dataset.filmGradeLocked === 'true' && !forceReprocess)) {
    return;
  }
  if (window.location.hostname.toLowerCase().includes('medium.com')) {
    return processMediumImage(originalImgElement, preset, enableGrain, enableVignette, forceReprocess);
  }
  if (originalImgElement.getAttribute(PROCESSING_ATTRIBUTE) === 'true') return;

  let processingTimeout: NodeJS.Timeout | null = null;
  try {
    originalImgElement.setAttribute(PROCESSING_ATTRIBUTE, 'true');
    processingTimeout = setTimeout(() => {
      if (originalImgElement.getAttribute(PROCESSING_ATTRIBUTE) === 'true') {
        originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
        debugLog('Processing timed out, canceled');
      }
    }, CONFIG.PROCESSING_TIMEOUT);
    
    // Special handling for picture elements and presentation images
    const isWithinPicture = originalImgElement.parentElement?.tagName.toLowerCase() === 'picture';
    const isPresentationImage = originalImgElement.getAttribute('role') === 'presentation';
    
    // For Medium.com-style images, use data-film-grade-original-src if it exists but wasn't set by us
    // This handles the case where the site already uses data URLs for initial loading
    let originalSrc = originalImgElement.getAttribute('src');
    
    // If we're on a site using data URLs for initial loading (like Medium),
    // and they've saved the original src in a data attribute, use that instead
    if (originalSrc && originalSrc.startsWith('data:image') && originalImgElement.dataset.filmGradeOriginalSrc) {
      // We'll use their saved original source instead of the data URL
      originalSrc = originalImgElement.dataset.filmGradeOriginalSrc;
      // But mark that we need to reprocess this image
      forceReprocess = true;
    }
    
    // If we don't have a valid source, we can't process
    if (!originalSrc) {
      originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
      if (processingTimeout) clearTimeout(processingTimeout);
      return;
    }

    const cacheKey = `${originalSrc}-${preset}-${enableGrain ? 1 : 0}-${enableVignette ? 1 : 0}`;

    // Skip if already processed with same settings or in cache
    // Only skip if we're not forcing reprocessing
    if (!forceReprocess && 
        processedUrlCache.has(cacheKey) && 
        originalImgElement.dataset.filmGradeProcessed === 'true') {
      debugLog(`Skipping already processed image with same settings: ${originalSrc.substring(0, 50)}...`);
      originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
      return;
    }
    
    // Load the image with crossorigin="anonymous" to avoid tainting the canvas
    const imageToProcess = await loadImageCrossOrigin(originalSrc);
    
    let width = imageToProcess.naturalWidth;
    let height = imageToProcess.naturalHeight;
    
    // Limit canvas size to prevent memory issues
    if (width > CONFIG.MAX_CANVAS_DIMENSION || height > CONFIG.MAX_CANVAS_DIMENSION) {
      const aspectRatio = width / height;
      if (width > height) {
        width = CONFIG.MAX_CANVAS_DIMENSION;
        height = Math.floor(width / aspectRatio);
      } else {
        height = CONFIG.MAX_CANVAS_DIMENSION;
        width = Math.floor(height * aspectRatio);
      }
    }
    
    if (width === 0 || height === 0) {
      originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
      return;
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
      return;
    }
    
    ctx.drawImage(imageToProcess, 0, 0, width, height);
    
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, width, height);
    } catch (err) {
      originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
      return; 
    }
    
    let processed = false;
    // Apply LUT if a preset is selected
    if (preset !== 'none') {
      try {
        const lutUrl = chrome.runtime.getURL(`assets/luts/${preset}.cube`);
        const response = await fetch(lutUrl);
        if (!response.ok) {
          throw new Error(`Failed to load LUT file: ${response.status}`);
        }
        const lutText = await response.text();
        const lut = parseCubeLUT(lutText, preset);
        if (lut.size === 0 || lut.data.length === 0) {
          throw new Error('Invalid LUT data');
        }
        const processedData = applyCubeLUT(imageData, lut);
        ctx.putImageData(processedData, 0, 0);
        processed = true;
      } catch (err) {
        // Just log to the console and continue
        debugError('LUT processing error', err);
      }
    }
    
    if (enableGrain) {
      applyGrain(ctx, canvas);
      processed = true;
    }
    if (enableVignette) {
      applyVignette(ctx, canvas);
      processed = true;
    }
    
    if (processed) {
      // Create the data URL first before modifying the element to minimize flicker
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      
      // TIERED APPROACH: Only use shadow DOM for problematic sites or special cases
      const shouldUseShadowDOM = 
        isProblematicSite() || // Known problematic site
        isWithinPicture ||     // Within a picture element (common issue with Medium)
        isPresentationImage || // Role="presentation" (common issue)
        originalImgElement.hasAttribute('data-nimg') || // Next.js image
        originalImgElement.closest('[data-nimg]') !== null; // Inside a Next.js image component
      
      if (shouldUseShadowDOM && originalImgElement.offsetParent !== null && originalImgElement.style.display !== 'none') {
        // Use robust shadow DOM approach for problematic sites/elements
        robustShadowReplace(originalImgElement, dataUrl);
      } else {
        // Use traditional src replacement for standard sites - much safer for carousels & animations
        // First lock the image to prevent the site from changing it back
        lockImageSrc(originalImgElement);
        
        // Handle picture elements for responsive images
        if (isWithinPicture) {
          disablePictureSourceElements(originalImgElement);
        }
        
        // Store the ORIGINAL source (not the data URL that might already be there)
        originalImgElement.dataset.filmGradeOriginalSrc = originalSrc;
        
        // Mark as processed by the extension
        originalImgElement.dataset.filmGradeProcessed = 'true';
        
        // Add to cache to prevent redundant processing
        processedUrlCache.add(cacheKey);
        
        // Allow our extension to modify the src
        originalImgElement.dataset.filmGradeAllowSet = 'true';
        
        // Now set the src to the processed image
        originalImgElement.src = dataUrl;
        
        // Prevent further modifications
        originalImgElement.dataset.filmGradeAllowSet = 'false';
      }
    } else {
      // If we didn't apply any processing, revert to original source if we have it
      if (originalImgElement.dataset.filmGradeOriginalSrc &&
          originalImgElement.src !== originalImgElement.dataset.filmGradeOriginalSrc) {
         originalImgElement.dataset.filmGradeAllowSet = 'true';
         originalImgElement.src = originalImgElement.dataset.filmGradeOriginalSrc;
         originalImgElement.dataset.filmGradeAllowSet = 'false';
         delete originalImgElement.dataset.filmGradeProcessed;
      }
      delete originalImgElement.dataset.filmGradeOriginalSrc;
    }
  } catch (err) {
    // Log the error
    debugError('Image processing error', err);
    
    // Try to revert to original source if available
    if (originalImgElement.dataset.filmGradeOriginalSrc && 
        originalImgElement.src !== originalImgElement.dataset.filmGradeOriginalSrc) {
        // Allow our extension to modify the src
        originalImgElement.dataset.filmGradeAllowSet = 'true';
        originalImgElement.src = originalImgElement.dataset.filmGradeOriginalSrc;
        originalImgElement.dataset.filmGradeAllowSet = 'false';
        delete originalImgElement.dataset.filmGradeProcessed;
    }
  } finally {
    // Critical: Create a small delay before removing the processing attribute
    // This helps prevent race conditions with multiple concurrent processing attempts
    setTimeout(() => {
      // Always remove processing attribute regardless of outcome
      originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
    }, 50);
  }
};

// Process a background image or text element
const processBackgroundImage = async (
  element: HTMLElement,
  preset: string,
  enableGrain: boolean = false,
  enableVignette: boolean = false,
  forceReprocess: boolean = false
): Promise<void> => {
  // First check if already processing to prevent race conditions
  if (element.getAttribute(PROCESSING_ATTRIBUTE) === 'true') {
    debugLog(`Skipping already processing background: ${element.className}`);
    return;
  }
  
  // Mark as processing BEFORE doing anything else
  element.setAttribute(PROCESSING_ATTRIBUTE, 'true');
  
  // First, check if this is a text-based element rather than a background image
  const isTextElement = !element.style.backgroundImage || element.style.backgroundImage === 'none';
  
  if (isTextElement) {
    // Process text-based element with CSS filters instead of canvas
    const result = await processTextElement(element, preset);
    // Remove processing attribute when text processing is done
    setTimeout(() => {
      element.removeAttribute(PROCESSING_ATTRIBUTE);
    }, 50);
    return result;
  }
  
  // Continue with regular background image processing
  const style = window.getComputedStyle(element);
  const bgImageStyle = style.backgroundImage;
  
  const match = bgImageStyle.match(/url\(['"]?(.*?)['"]?\)/);
  if (!match || !match[1]) {
    element.removeAttribute(PROCESSING_ATTRIBUTE);
    return;
  }
  
  const imageUrl = match[1];
  if (!imageUrl || imageUrl === 'none' || imageUrl.trim() === '') {
    element.removeAttribute(PROCESSING_ATTRIBUTE);
    return;
  }

  const processedUrl = element.dataset.filmGradeOriginalSrc;
  const cacheKey = `${imageUrl}-${preset}-${enableGrain ? 1 : 0}-${enableVignette ? 1 : 0}`;
  
  // Skip if already processed with same settings or in cache
  if (!forceReprocess && 
      processedUrlCache.has(cacheKey) && 
      element.dataset.filmGradeProcessed === 'true') {
    debugLog(`Skipping already processed background with same settings`);
    element.removeAttribute(PROCESSING_ATTRIBUTE);
    return;
  }

  try {
    const imageToProcess = await loadImageCrossOrigin(imageUrl);

    const canvas = document.createElement('canvas');
    canvas.width = imageToProcess.naturalWidth;
    canvas.height = imageToProcess.naturalHeight;
    
    if (canvas.width === 0 || canvas.height === 0) {
      element.removeAttribute(PROCESSING_ATTRIBUTE);
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      element.removeAttribute(PROCESSING_ATTRIBUTE);
      return;
    }
    
    ctx.drawImage(imageToProcess, 0, 0);
    
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (err) {
      element.removeAttribute(PROCESSING_ATTRIBUTE);
      return;
    }
    
    let processed = false;
    if (preset !== 'none') {
      try {
        const lutUrl = chrome.runtime.getURL(`assets/luts/${preset}.cube`);
        const response = await fetch(lutUrl);
        if (!response.ok) {
          throw new Error(`Failed to load LUT file: ${response.status}`);
        }
        const lutText = await response.text();
        const lut = parseCubeLUT(lutText, preset);
        if (lut.size === 0 || lut.data.length === 0) {
          throw new Error('Invalid LUT data');
        }
        const processedData = applyCubeLUT(imageData, lut);
        ctx.putImageData(processedData, 0, 0);
        processed = true;
      } catch (err) {
        // Silent fail in production mode
        debugError('LUT error for background', err);
      }
    }
    
    if (enableGrain) {
      applyGrain(ctx, canvas);
      processed = true;
    }
    if (enableVignette) {
      applyVignette(ctx, canvas);
      processed = true;
    }
    
    if (processed) {
      // Generate data URL first before changing the element
      const dataUrl = canvas.toDataURL();
      
      // Save the original URL and mark as processed
      element.dataset.filmGradeOriginalSrc = imageUrl;
      element.dataset.filmGradeProcessed = 'true';
      
      // Add to cache to prevent redundant processing
      processedUrlCache.add(cacheKey);
      
      // Now update the background image
      element.style.backgroundImage = `url('${dataUrl}')`;
    } else {
      if (element.style.backgroundImage.startsWith('url("data:image') && element.dataset.filmGradeOriginalSrc) {
          element.style.backgroundImage = `url('${element.dataset.filmGradeOriginalSrc}')`;
          delete element.dataset.filmGradeProcessed;
      }
      delete element.dataset.filmGradeOriginalSrc;
    }
  } catch (err) {
    // Silent fail in production mode
    debugError('Processing error for background', err);
    
    if (element.dataset.filmGradeOriginalSrc && element.style.backgroundImage !== `url('${element.dataset.filmGradeOriginalSrc}')`) {
        element.style.backgroundImage = `url('${element.dataset.filmGradeOriginalSrc}')`;
        delete element.dataset.filmGradeProcessed;
    }
  } finally {
    // Add a delay before removing processing attribute to prevent race conditions
    setTimeout(() => {
      element.removeAttribute(PROCESSING_ATTRIBUTE);
    }, 50);
  }
};

// Process text elements using CSS filters instead of canvas
const processTextElement = async (
  element: HTMLElement,
  preset: string
): Promise<void> => {
  try {
    // Skip if already processed
    if (element.dataset.filmGradeOriginalStyles) {
      return;
    }
    
    // Save original styles for reverting later
    const originalStyles = {
      filter: element.style.filter || '',
      backgroundColor: element.style.backgroundColor || '',
      color: element.style.color || '',
      borderColor: element.style.borderColor || '',
      outline: element.style.outline || ''
    };
    
    // Store original styles as JSON in data attribute
    element.dataset.filmGradeOriginalStyles = JSON.stringify(originalStyles);
    
    // Apply filter based on preset
    switch (preset) {
      case 'greyscale':
        element.style.filter = `grayscale(100%) ${originalStyles.filter}`;
        break;
      case 'fuji':
        // Fuji film look with CSS filters
        element.style.filter = `saturate(0.9) sepia(0.2) contrast(1.1) ${originalStyles.filter}`;
        break;
      case 'kodak':
        // Kodak film look with CSS filters
        element.style.filter = `saturate(1.1) sepia(0.15) contrast(1.05) brightness(1.05) ${originalStyles.filter}`;
        break;
      default:
        // Reset to original
        delete element.dataset.filmGradeOriginalStyles;
        break;
    }
    
    // Mark as processed
    element.dataset.filmGradeProcessed = 'css';
  } catch (err) {
    debugError('Error processing text element', err);
    
    // Revert to original styles if there's an error
    if (element.dataset.filmGradeOriginalStyles) {
      try {
        const originalStyles = JSON.parse(element.dataset.filmGradeOriginalStyles);
        element.style.filter = originalStyles.filter;
        element.style.backgroundColor = originalStyles.backgroundColor;
        element.style.color = originalStyles.color;
        element.style.borderColor = originalStyles.borderColor;
        element.style.outline = originalStyles.outline;
      } catch (e) {
        // Silent fail if JSON parsing fails
      }
      
      delete element.dataset.filmGradeOriginalStyles;
      delete element.dataset.filmGradeProcessed;
    }
  }
};

// Store last applied settings to detect actual changes
let lastAppliedSettings = { preset: '', enableGrain: false, enableVignette: false, isEnabled: true };

// Throttling implementation to prevent rapid processing
let processingTask: null | NodeJS.Timeout = null;
const throttleProcessing = (fn: Function, delay = 300) => {
  return (...args: any[]): Promise<void> => {
    return new Promise((resolve) => {
      if (processingTask) {
        clearTimeout(processingTask);
      }
      
      processingTask = setTimeout(() => {
        Promise.resolve(fn(...args)).then(() => {
          processingTask = null;
          resolve();
        });
      }, delay);
    });
  };
};

// Function to revert a single element to its original state more comprehensively
const revertElement = (element: HTMLElement) => {
  try {
    // 1. Handle Robust Shadow DOM replacement
    const shadowHost = element.previousElementSibling;
    if (shadowHost && shadowHost.classList.contains('film-grade-robust-wrapper') && shadowHost.shadowRoot) {
      shadowHost.remove();
      // Restore original image display (assuming it was the next sibling)
      if (element.style.opacity === '0') element.style.opacity = '1';
      if (element.style.pointerEvents === 'none') element.style.pointerEvents = 'auto';
      element.removeAttribute('data-film-grade-robust-shadow');
    }

    // 2. Handle standard image src replacement
    if (element instanceof HTMLImageElement) {
      const originalSrc = element.dataset.filmGradeOriginalSrc;
      if (originalSrc && element.src !== originalSrc) {
        element.dataset.filmGradeAllowSet = 'true'; // Allow src change
        element.src = originalSrc;
        element.dataset.filmGradeAllowSet = 'false'; // Re-protect if still locked (though lock should be removed)
      }
      // Restore original setAttribute if it was overridden by lockImageSrc
      if ((element as any).originalSetAttribute) {
        element.setAttribute = (element as any).originalSetAttribute;
        delete (element as any).originalSetAttribute;
      }
      delete element.dataset.filmGradeOriginalSrc;
      delete element.dataset.filmGradeProcessed;
      delete element.dataset.filmGradeLocked; // Remove lock
    }
    // 3. Handle background image replacement
    else if (element.dataset.filmGradeOriginalSrc && element.style.backgroundImage.startsWith('url("data:image')) {
      const originalBg = element.dataset.filmGradeOriginalSrc;
      if (element.style.backgroundImage !== `url('${originalBg}')`) {
        element.style.backgroundImage = `url('${originalBg}')`;
      }
      delete element.dataset.filmGradeOriginalSrc;
      delete element.dataset.filmGradeProcessed;
    }

    // 4. Restore <source> elements in <picture>
    const pictureParent = element.closest('picture');
    if (pictureParent && pictureParent.dataset.filmGradeSourcesDisabled === 'true') {
      const sourceElements = pictureParent.querySelectorAll('source[data-film-grade-original-srcset]');
      sourceElements.forEach((sourceEl: any) => {
        const source = sourceEl as HTMLSourceElement;
        if (source.dataset.filmGradeOriginalSrcset) {
          source.srcset = source.dataset.filmGradeOriginalSrcset;
          delete source.dataset.filmGradeOriginalSrcset;
        }
      });
      delete pictureParent.dataset.filmGradeSourcesDisabled;
    }

    // 5. Clean up any remaining attributes
    element.removeAttribute(PROCESSING_ATTRIBUTE);
    element.removeAttribute('data-film-grade-robust-shadow'); // Ensure robust shadow flag is cleared

  } catch (err) {
    debugError('Error reverting element', err, element);
  }
};

// Optimized batch processing using requestIdleCallback for better responsiveness
const processAllMedia = async (
  preset: string, 
  enableGrain: boolean = false, 
  enableVignette: boolean = false,
  isEnabled: boolean = true,
  forceReprocessAll: boolean = false
): Promise<void> => {
  if (!isEnabled || preset === 'none') {
    // If disabling, revert all processed images
    if (!isEnabled) {
      const allProcessed = document.querySelectorAll('[data-film-grade-processed], [data-film-grade-robust-shadow]');
      allProcessed.forEach(el => revertElement(el as HTMLElement));
      // Clear shadow hosts too
      document.querySelectorAll('.film-grade-shadow-host').forEach(host => host.remove());
    }
    return;
  }

  const { regular, large } = findMediaElements(); // Already optimized
  const allElements = [...regular, ...large];
  if (allElements.length === 0) return;

  updateGlobalIndicator(true, `Processing ${allElements.length} images...`);
  let processedCount = 0;
  let failedCount = 0;

  const processElement = async (element: HTMLElement) => {
    try {
      if (element instanceof HTMLImageElement) {
        await processImage(element, preset, enableGrain, enableVignette, forceReprocessAll);
      } else {
        await processBackgroundImage(element, preset, enableGrain, enableVignette, forceReprocessAll);
      }
      processedCount++;
    } catch (err) {
      failedCount++;
      debugError('Error processing element in batch', err);
    }
  };

  // Prioritize immediately visible elements
  const visibleElements: HTMLElement[] = [];
  const deferredElements: HTMLElement[] = [];

  allElements.forEach(element => {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0) {
      visibleElements.push(element);
    } else {
      deferredElements.push(element);
    }
  });

  // Process visible elements immediately in small batches
  for (let i = 0; i < visibleElements.length; i += CONFIG.BATCH_SIZE) {
    const batch = visibleElements.slice(i, i + CONFIG.BATCH_SIZE);
    await Promise.all(batch.map(el => processElement(el)));
    updateGlobalIndicator(true, `Processing: ${Math.round((processedCount / allElements.length) * 100)}%`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY)); // Small delay between batches
  }

  // Process deferred elements using requestIdleCallback
  let deferredIndex = 0;
  const processDeferredBatch = (deadline?: IdleDeadline) => {
    while ((deadline && deadline.timeRemaining() > 0 || !deadline) && deferredIndex < deferredElements.length) {
      const element = deferredElements[deferredIndex];
      processElement(element).then(() => {
        updateGlobalIndicator(true, `Processing: ${Math.round((processedCount / allElements.length) * 100)}%`);
      });
      deferredIndex++;
      if (deferredIndex % CONFIG.BATCH_SIZE === 0 && deadline) break; // Yield after a batch if there's a deadline
    }
    if (deferredIndex < deferredElements.length) {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(processDeferredBatch, { timeout: 500 });
      } else {
        setTimeout(() => processDeferredBatch(), 100); // Fallback
      }
    }
  };

  if (deferredElements.length > 0) {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(processDeferredBatch, { timeout: 500 });
    } else {
      setTimeout(() => processDeferredBatch(), 100); // Fallback
    }
  }
  
  // Final completion update (might be slightly off if idle callbacks are still running)
  // Consider a more robust completion mechanism if exact count is critical immediately
  // For now, this provides a good estimate.
  const finalUpdateTimeout = setTimeout(() => {
    finishProcessing(preset, enableGrain, enableVignette, isEnabled, processedCount, 0, failedCount);
  }, deferredElements.length > 0 ? 2000 : 500); // Longer timeout if there were deferred elements
  processingResources.registerTimer(finalUpdateTimeout);
};

// Create the throttled version of processAllMedia for use with messages
const throttledProcessAllMedia = throttleProcessing(processAllMedia);

// Add a function to periodically check for new content
const checkForNewContent = async (
  preset: string,
  enableGrain: boolean,
  enableVignette: boolean, 
  isEnabled: boolean
) => {
  if (!isEnabled || preset === 'none') return;
  
  try {
    // Find any unprocessed media elements
    const { regular, large } = findMediaElements();
    
    // If we find new unprocessed elements, process them
    if (regular.length > 0 || large.length > 0) {
      debugLog(`Found new content to process: ${regular.length + large.length} elements`);
      await processAllMedia(preset, enableGrain, enableVignette, isEnabled, false);
    } else {
      // Schedule another check later
      setTimeout(() => {
        // Continue with the same settings
        checkForNewContent(preset, enableGrain, enableVignette, isEnabled);
      }, CONFIG.CONTENT_CHECK_INTERVAL);
    }
  } catch (error) {
    debugError('Error in checkForNewContent, will retry', error);
    // Even if there's an error, continue checking after a delay
    setTimeout(() => {
      checkForNewContent(preset, enableGrain, enableVignette, isEnabled);
    }, CONFIG.CONTENT_CHECK_INTERVAL * 2); // Wait a bit longer after an error
  }
};

// Optimized MutationObserver with leaner callback and deferred processing
const observeDOM = (settings: { preset: string, enableGrain: boolean, enableVignette: boolean, isEnabled: boolean }) => {
  const { preset, enableGrain, enableVignette, isEnabled } = settings;
  let debounceTimeout: NodeJS.Timeout | null = null;

  // Lean function to quickly check if media was added or changed
  const quickCheckMutation = (mutation: MutationRecord): boolean => {
    if (mutation.type === 'childList') {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof HTMLElement) {
          if (node.nodeName === 'IMG' || node.nodeName === 'VIDEO' || (node.style && node.style.backgroundImage)) return true;
          if (node.querySelector('img, video, [style*="background-image"]')) return true; // Check children quickly
        }
      }
    } else if (mutation.type === 'attributes') {
      const target = mutation.target as HTMLElement;
      if (target.nodeName === 'IMG' && mutation.attributeName === 'src' && !target.hasAttribute('data-film-grade-processed')) return true;
      if (mutation.attributeName === 'style' && target.style.backgroundImage && target.style.backgroundImage !== 'none' && !target.hasAttribute('data-film-grade-processed')) return true;
    }
    return false;
  };

  const handleMutationsOptimized = (mutations: MutationRecord[]) => {
    if (!isEnabled || preset === 'none') return;

    let mediaPossiblyChanged = false;
    for (const mutation of mutations) {
      if (quickCheckMutation(mutation)) {
        mediaPossiblyChanged = true;
        break;
      }
    }

    if (mediaPossiblyChanged) {
      if (debounceTimeout) clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        // Defer the actual processing to avoid blocking the main thread
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(() => processAllMedia(preset, enableGrain, enableVignette, isEnabled, false), { timeout: 1000 });
        } else {
          // Fallback for browsers that don't support requestIdleCallback
          setTimeout(() => processAllMedia(preset, enableGrain, enableVignette, isEnabled, false), 200);
        }
      }, 300); // Debounce for 300ms
    }
  };

  const observer = new MutationObserver(handleMutationsOptimized);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'style', 'class'] // Observe class changes too, as frameworks often use classes for state
  });
  
  processingResources.registerObserver(observer); // Register for cleanup
  return observer;
};

// Store the active observer reference
let activeObserver: MutationObserver | null = null;

// Initialize the content script
const initializeProcessor = async () => {
  debugLog('Content script initializing...'); // New log
  // setupLoadingStyles(); // Styles are now injected even earlier

  const settings = await getFilterSettings();
  lastAppliedSettings = { ...settings };

  try {
    if (settings.isEnabled && settings.preset !== 'none') {
      debugLog(`Applying initial filter: ${settings.preset}`);
      await processAllMedia(settings.preset, settings.enableGrain, settings.enableVignette, settings.isEnabled, true);
      if (CONFIG.ENABLE_CONTINUOUS_PROCESSING) {
        setTimeout(() => {
          checkForNewContent(settings.preset, settings.enableGrain, settings.enableVignette, settings.isEnabled);
        }, CONFIG.CONTENT_CHECK_INTERVAL);
      }
    } else {
      const allElements = findAllMediaElements(); // Ensure it's called after DOM is ready
      for (const element of allElements) {
        revertElement(element);
      }
    }
  } catch (e) {
    debugError('Error during initial processing', e); // Changed log message
  }
  
  if (activeObserver) {
    activeObserver.disconnect();
    activeObserver = null;
  }
  activeObserver = observeDOM(settings);
  debugLog('Content script initialized and observer started.'); // New log
};

// --- Script Entry Point --- 
// Inject critical styles immediately
setupLoadingStyles(); 

if (document.readyState === 'loading') {
  debugLog('Content script loaded early, waiting for DOMContentLoaded.'); // New log
  document.addEventListener('DOMContentLoaded', initializeProcessor);
} else {
  // DOM is already loaded or past loading (e.g., interactive or complete)
  debugLog('Content script loaded after DOMContentLoaded, initializing directly.'); // New log
  initializeProcessor();
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

// Add these type definitions to make TypeScript happy with our global extensions
interface Window {
  findMediaElements: () => MediaElements;
  findAllMediaElements: () => HTMLElement[];
  FilmGradeExt: {
    callCount: number;
    findMediaElements?: () => MediaElements;
    findAllMediaElements?: () => HTMLElement[];
    lastResult?: MediaElements;
  };
}

// Process refreshes in a way that works with the bundled code
// This avoids the "findMediaElements is not a function" error
const refreshHandler = async () => {
  try {
    debugLog("Refresh handler called");
    const settings = await getFilterSettings();
    
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
    
    if (settings.isEnabled && settings.preset !== 'none') {
      // Get all media elements with our safe function - try multiple approaches
      let mediaElements: HTMLElement[] = [];
      
      try {
        // Try our namespace first
        if (window.FilmGradeExt && typeof window.FilmGradeExt.findAllMediaElements === 'function') {
          mediaElements = window.FilmGradeExt.findAllMediaElements();
          debugLog("Got media elements from FilmGradeExt namespace");
        }
        // Try direct global access
        else if (typeof window["__findAllMediaElements"] === 'function') {
          mediaElements = window["__findAllMediaElements"]();
          debugLog("Got media elements from direct global access");
        }
        // Try the regular window approach
        else if (typeof window.findAllMediaElements === 'function') {
          mediaElements = window.findAllMediaElements();
          debugLog("Got media elements from window object");
        }
        // Try calling directly
        else if (typeof findAllMediaElements === 'function') {
          mediaElements = findAllMediaElements();
          debugLog("Got media elements by direct function call");
        }
        // Last resort: search DOM directly
        else {
          debugLog("All function approaches failed, searching DOM directly");
          const images = document.querySelectorAll('img');
          images.forEach(img => {
            if ((img as HTMLImageElement).width > 50 && (img as HTMLImageElement).height > 50) {
              mediaElements.push(img as HTMLImageElement);
            }
          });
        }
      } catch (e) {
        debugError("Error getting media elements, using fallback", e);
        // Last resort fallback: search directly 
        const images = document.querySelectorAll('img');
        images.forEach(img => mediaElements.push(img as HTMLImageElement));
      }
      
      debugLog(`Processing ${mediaElements.length} elements`);
      
      // Process each element individually
      for (let i = 0; i < mediaElements.length; i++) {
        const element = mediaElements[i];
        try {
          if (element instanceof HTMLImageElement) {
            await processImage(element, settings.preset, settings.enableGrain, settings.enableVignette, true);
          } else if (element.style && element.style.backgroundImage && element.style.backgroundImage.includes('url')) {
            await processBackgroundImage(element, settings.preset, settings.enableGrain, settings.enableVignette, true);
          }
        } catch (elementError) {
          debugError(`Error processing element ${i}`, elementError);
          // Continue with next element
        }
      }
    }
    
    // Restart observer
    activeObserver = observeDOM(settings);
    return { success: true, message: "Refresh completed" };
  } catch (error) {
    debugError('Error in refresh handler', error);
    return { success: false, error: String(error) };
  }
};

// Listen for messages from the popup or background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'applyFilter') {
    debugLog('Filter request received');
    
    const settingsChanged = message.preset !== lastAppliedSettings.preset || 
                          message.enableGrain !== lastAppliedSettings.enableGrain || 
                          message.enableVignette !== lastAppliedSettings.enableVignette ||
                          message.isEnabled !== lastAppliedSettings.isEnabled;

    throttledProcessAllMedia(message.preset, message.enableGrain, message.enableVignette, message.isEnabled, settingsChanged)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        debugError('Error processing request', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Indicate async response
  } else if (message.action === 'refresh') {
    // Handle refresh action with our new refreshHandler
    refreshHandler()
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({ success: false, error: String(error) });
      });
    
    return true; // Indicate async response
  }
});

// Add a function to perform a full-page scan for any missed images
const performFullPageScan = async (
  preset: string,
  enableGrain: boolean,
  enableVignette: boolean,
  isEnabled: boolean
): Promise<void> => {
  if (!isEnabled || preset === 'none') return;
  
  debugLog("Performing full page scan for missed images");
  
  try {
    // Temporarily disable viewport restrictions
    const originalViewportExpansion = CONFIG.VIEWPORT_EXPANSION;
    CONFIG.VIEWPORT_EXPANSION = 100000; // Effectively infinite
    
    // Find all media elements without viewport restrictions
    const allElements = findAllMediaElements();
    
    // Check for unprocessed elements
    const unprocessedElements = allElements.filter(element => {
      if (element instanceof HTMLImageElement) {
        // Skip if already processed with a data URL
        return !(element.src && element.src.startsWith('data:image') && element.dataset.filmGradeOriginalSrc);
      } else if (element.style && element.style.backgroundImage) {
        return !(element.style.backgroundImage.startsWith('url("data:image') && 
                element.dataset.filmGradeOriginalSrc);
      }
      return false;
    });
    
    // Process any unprocessed elements
    if (unprocessedElements.length > 0) {
      debugLog(`Full page scan found ${unprocessedElements.length} unprocessed elements`);
      
      // Process in small batches to avoid UI freezing
      const batchSize = CONFIG.BATCH_SIZE;
      for (let i = 0; i < unprocessedElements.length; i += batchSize) {
        const batch = unprocessedElements.slice(i, i + batchSize);
        
        for (const element of batch) {
          try {
            if (element instanceof HTMLImageElement) {
              await processImage(element, preset, enableGrain, enableVignette, true);
            } else if (element.style && element.style.backgroundImage && element.style.backgroundImage.includes('url')) {
              await processBackgroundImage(element, preset, enableGrain, enableVignette, true);
            }
          } catch (error) {
            debugError(`Error processing element in full page scan`, error);
          }
        }
        
        // Pause briefly between batches to avoid locking up the UI
        await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
      }
      
      // Schedule another check in case there are still more to process
      setTimeout(() => {
        checkForNewContent(preset, enableGrain, enableVignette, isEnabled);
      }, CONFIG.CONTENT_CHECK_INTERVAL);
    } else {
      debugLog("Full page scan complete, no unprocessed elements found");
    }
    
    // Restore original viewport expansion
    CONFIG.VIEWPORT_EXPANSION = originalViewportExpansion;
  } catch (error) {
    debugError("Error in full page scan", error);
  }
};

// Finish processing and clean up
const finishProcessing = (
  preset: string,
  enableGrain: boolean,
  enableVignette: boolean,
  isEnabled: boolean,
  imageCount: number,
  largeImageCount: number,
  failedCount: number
) => {
  lastAppliedSettings = { preset, enableGrain, enableVignette, isEnabled };
  
  // Show completion message with counts
  updateGlobalIndicator(true, `Complete: ${imageCount + largeImageCount} images processed (${failedCount} failed)`);
  
  // Hide the indicator after a delay
  setTimeout(() => {
    updateGlobalIndicator(false);
    
    // Perform a full page scan to catch any missed images
    setTimeout(() => {
      performFullPageScan(preset, enableGrain, enableVignette, isEnabled);
    }, 1000);
    
    // Schedule another check after completion to catch any new images that appeared during processing
    if (isEnabled && preset !== 'none' && CONFIG.ENABLE_CONTINUOUS_PROCESSING) {
      setTimeout(() => {
        checkForNewContent(preset, enableGrain, enableVignette, isEnabled);
      }, CONFIG.CONTENT_CHECK_INTERVAL);
    }
  }, 1500);
};

// Helper function to lock an image's src property to prevent it from being changed by site's JavaScript
const lockImageSrc = (imgElement: HTMLImageElement): void => {
  // Skip if already locked
  if (imgElement.dataset.filmGradeLocked === 'true') {
    return;
  }
  
  // Mark as locked
  imgElement.dataset.filmGradeLocked = 'true';
  
  try {
    // Get the original src property descriptor
    const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (!originalSrcDescriptor) {
      debugError('Failed to get src property descriptor');
      return;
    }
    
    // Create a new property descriptor that prevents site JS from changing src
    Object.defineProperty(imgElement, 'src', {
      set(value: string) {
        // Allow our extension to set the src when needed
        if (imgElement.dataset.filmGradeAllowSet === 'true') {
          // Call the original setter
          originalSrcDescriptor.set.call(this, value);
        } else {
          // Log attempt to change src (only in debug mode)
          if (CONFIG.DEBUG) {
            debugLog(`Blocked attempt to change src to: ${value.substring(0, 50)}...`);
          }
        }
      },
      get() {
        // Always use the original getter
        return originalSrcDescriptor.get.call(this);
      },
      configurable: true // Allow the property to be redefined if needed
    });
    
    // Also lock the setAttribute method for src to prevent changes through setAttribute
    const originalSetAttribute = imgElement.setAttribute;
    imgElement.setAttribute = function(name: string, value: string) {
      if (name.toLowerCase() === 'src' && imgElement.dataset.filmGradeAllowSet !== 'true') {
        // Block setAttribute for src unless allowed
        if (CONFIG.DEBUG) {
          debugLog(`Blocked setAttribute attempt for src: ${value.substring(0, 50)}...`);
        }
        return;
      }
      // Call original for all other attributes
      return originalSetAttribute.call(this, name, value);
    };
    
    debugLog('Successfully locked image src', imgElement);
  } catch (err) {
    debugError('Error locking image src', err);
  }
};

// Helper function to handle responsive picture elements after processing an image
const disablePictureSourceElements = (imgElement: HTMLImageElement): void => {
  try {
    // Check if this is inside a picture element
    const pictureParent = imgElement.closest('picture');
    if (!pictureParent) return;
    
    // Find all source elements within the picture element
    const sourceElements = pictureParent.querySelectorAll('source');
    if (sourceElements.length === 0) return;
    
    debugLog(`Found ${sourceElements.length} source elements in picture, disabling them`);
    
    // Store the original srcset values for potential future restoration
    if (!pictureParent.dataset.filmGradeSourcesDisabled) {
      // We only want to save the original state once
      const originalSources: { element: HTMLSourceElement, srcset: string }[] = [];
      
      sourceElements.forEach((source: HTMLSourceElement) => {
        if (source.srcset) {
          originalSources.push({
            element: source,
            srcset: source.srcset
          });
        }
      });
      
      // Store original sources in a data attribute on the picture element
      if (originalSources.length > 0) {
        // We can't store the actual elements, just the indices
        pictureParent.dataset.filmGradeSourcesDisabled = 'true';
        
        // Now disable all source elements to prevent them from affecting the img
        sourceElements.forEach((source: HTMLSourceElement) => {
          // Save original for debugging
          source.dataset.filmGradeOriginalSrcset = source.srcset;
          
          // Empty the srcset to disable the source
          source.srcset = '';
        });
      }
    }
  } catch (err) {
    debugError('Error disabling source elements', err);
  }
};

// Helper function to lock parent elements that might override our image processing
const lockParentElements = (imgElement: HTMLImageElement): void => {
  try {
    // First check if we're inside complex structures with nested spans or other containers
    const parentSpan = imgElement.closest('span');
    const parentA = imgElement.closest('a');
    const parentWrapperEl = imgElement.closest('[data-nimg], [data-rmlz-wrap], [data-image-wrapper]');
    const parentWrapper = parentWrapperEl as HTMLElement;
    
    // Traverse up to 3 levels of parent elements to lock relevant ones
    let currentElement: HTMLElement | null = imgElement;
    let levelsUp = 0;
    
    while (currentElement && levelsUp < 3) {
      const parent = currentElement.parentElement;
      if (!parent) break;
      
      // Check if this is a wrapper element that might interfere
      const isImageWrapper = 
        parent.tagName.toLowerCase() === 'span' || 
        parent.tagName.toLowerCase() === 'a' ||
        parent.tagName.toLowerCase() === 'div' ||
        parent.hasAttribute('data-nimg') ||
        parent.hasAttribute('data-image-wrapper') ||
        parent.hasAttribute('data-src') ||
        parent.style.position === 'relative' ||
        parent.style.position === 'absolute' ||
        parent.style.display === 'inline-block' ||
        parent.classList.contains('image-wrapper');
      
      if (isImageWrapper) {
        // Skip elements we've already processed
        if (parent.dataset.filmGradeParentLocked === 'true') {
          break;
        }
        
        // Mark this parent as locked
        parent.dataset.filmGradeParentLocked = 'true';
        
        // Preserve existing z-index
        const currentZIndex = window.getComputedStyle(parent).zIndex;
        if (currentZIndex === 'auto' || !currentZIndex) {
          // Set a high z-index to ensure our processed image stays on top
          parent.style.zIndex = '1';
        }
        
        // Lock background-image if present
        if (parent.style.backgroundImage && !parent.style.backgroundImage.includes('none')) {
          const originalBackgroundImage = parent.style.backgroundImage;
          parent.dataset.filmGradeOriginalBg = originalBackgroundImage;
          
          // Override the setter for backgroundImage
          try {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype.style, 'backgroundImage');
            if (descriptor && descriptor.configurable) {
              Object.defineProperty(parent.style, 'backgroundImage', {
                get: function() {
                  return descriptor.get!.call(this);
                },
                set: function(value) {
                  if (parent.dataset.filmGradeAllowBgSet === 'true') {
                    descriptor.set!.call(this, value);
                  } else if (CONFIG.DEBUG) {
                    debugLog(`Blocked attempt to change backgroundImage on parent: ${value.substring(0, 50)}...`);
                  }
                },
                configurable: true
              });
            }
          } catch (err) {
            debugError('Error locking parent backgroundImage', err);
          }
        }
        
        // Lock the cssText property if possible
        try {
          const originalCssText = parent.style.cssText;
          parent.dataset.filmGradeOriginalCss = originalCssText;
          
          // Override the setter for cssText
          const descriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'cssText');
          if (descriptor && descriptor.configurable) {
            Object.defineProperty(parent.style, 'cssText', {
              get: function() {
                return descriptor.get!.call(this);
              },
              set: function(value) {
                if (parent.dataset.filmGradeAllowCssSet === 'true') {
                  descriptor.set!.call(this, value);
                } else if (CONFIG.DEBUG) {
                  debugLog(`Blocked attempt to change cssText on parent: ${value.substring(0, 50)}...`);
                }
              },
              configurable: true
            });
          }
        } catch (err) {
          debugError('Error locking parent cssText', err);
        }
      }
      
      // Move up to the next parent
      currentElement = parent;
      levelsUp++;
    }
    
    // Special handling for sites like HackerNoon that use data-nimg="intrinsic"
    if (parentWrapper && parentWrapper.hasAttribute('data-nimg')) {
      // This is likely a Next.js image component
      debugLog('Detected Next.js image component, applying special handling');
      
      // Lock the parent wrapper
      parentWrapper.dataset.filmGradeParentLocked = 'true';
      
      // Find any sibling span elements that might be placeholders
      const siblings = parentWrapper.querySelectorAll('span');
      siblings.forEach(spanEl => {
        const span = spanEl as HTMLSpanElement;
        if (span !== imgElement && !span.contains(imgElement)) {
          // Mark these spans to prevent them from interfering
          span.dataset.filmGradeIgnore = 'true';
          
          // Ensure they don't override our styles
          span.style.opacity = '0';
          span.style.pointerEvents = 'none';
        }
      });
    }
  } catch (err) {
    debugError('Error in lockParentElements', err);
  }
};

// Enhanced shadow DOM replacement that's resistant to React/Next.js rerendering
const robustShadowReplace = (originalImg: HTMLImageElement, processedDataUrl: string) => {
  // Skip if this element has already been processed with our robust shadow
  if (originalImg.hasAttribute('data-film-grade-robust-shadow')) {
    return;
  }
  
  // Mark the original image as processed with robust shadow
  originalImg.setAttribute('data-film-grade-robust-shadow', 'true');
  
  try {
    // 1. Get exact position and dimensions for perfect overlay
    const rect = originalImg.getBoundingClientRect();
    const styles = window.getComputedStyle(originalImg);
    
    // Collect all the computed styles we want to preserve
    const stylesToPreserve = {
      width: rect.width + 'px',
      height: rect.height + 'px',
      position: 'absolute',
      top: '0',
      left: '0',
      objectFit: styles.objectFit || 'cover',
      objectPosition: styles.objectPosition || 'center',
      zIndex: '10000', // Very high to ensure visibility
      display: 'block',
      margin: '0',
      padding: '0',
      border: 'none',
      maxWidth: '100%',
      maxHeight: '100%'
    };
    
    // 2. Create a wrapper that will position at the exact same place
    const wrapper = document.createElement('div');
    wrapper.className = 'film-grade-robust-wrapper';
    Object.assign(wrapper.style, {
      position: 'relative',
      width: rect.width + 'px',
      height: rect.height + 'px',
      margin: '0',
      padding: '0',
      display: styles.display !== 'none' ? styles.display : 'block',
      zIndex: styles.zIndex !== 'auto' ? styles.zIndex : '1'
    });
    
    // 3. Create a closed shadow DOM (more resistant to external access)
    const shadow = wrapper.attachShadow({ mode: 'closed' });
    
    // 4. Create styles inside the shadow DOM to isolate from page styles
    const shadowStyle = document.createElement('style');
    shadowStyle.textContent = `
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .processed-img {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: inherit;
        object-position: inherit;
        display: block;
      }
    `;
    shadow.appendChild(shadowStyle);
    
    // 5. Create the processed image inside the shadow DOM
    const processedImg = document.createElement('img');
    processedImg.src = processedDataUrl;
    processedImg.alt = originalImg.alt || '';
    processedImg.className = 'processed-img';
    // Copy all relevant styles to ensure it looks identical
    Object.assign(processedImg.style, stylesToPreserve);
    shadow.appendChild(processedImg);
    
    // 6. Clone original into shadow DOM to maintain any event listeners (optional, hidden by default)
    const originalClone = originalImg.cloneNode(true) as HTMLImageElement;
    originalClone.style.opacity = '0';
    originalClone.style.position = 'absolute';
    originalClone.style.pointerEvents = 'none';
    shadow.appendChild(originalClone);
    
    // 7. Handle parent positioning - this is critical for proper placement
    if (originalImg.parentElement) {
      // Check if parent is position: static which causes placement issues
      const parentStyles = window.getComputedStyle(originalImg.parentElement);
      if (parentStyles.position === 'static') {
        originalImg.parentElement.style.position = 'relative';
      }
      
      // Insert wrapper right before the original img
      originalImg.parentElement.insertBefore(wrapper, originalImg);
    }
    
    // 8. Hide original image but don't remove it (keeps React happy)
    originalImg.style.opacity = '0';
    originalImg.style.position = 'absolute';
    originalImg.style.pointerEvents = 'none';
    
    // 9. Setup self-healing with advanced MutationObserver
    const selfHealImg = (mutations: MutationRecord[]) => {
      // Check if our processed element was removed
      if (!wrapper.isConnected && originalImg.isConnected && originalImg.parentElement) {
        // Reinsert wrapper
        originalImg.parentElement.insertBefore(wrapper, originalImg);
        originalImg.style.opacity = '0';
      }
      
      // Check if original became visible again
      if (originalImg.style.opacity !== '0' || originalImg.style.display !== 'none') {
        originalImg.style.opacity = '0';
        originalImg.style.pointerEvents = 'none';
      }
    };
    
    // Watch for changes to the original image and its parent
    const observer = new MutationObserver(selfHealImg);
    
    if (originalImg.parentElement) {
      observer.observe(originalImg.parentElement, {
        childList: true,      // Watch for removal/addition
        attributes: true,     // Watch for style changes
        subtree: false        // No need to go deeper
      });
    }
    
    // Also observe the original image itself for attribute changes
    observer.observe(originalImg, {
      attributes: true,       // Watch for style changes
      attributeFilter: ['style', 'src', 'class'] // Only these attributes
    });
    
    // 10. Bonus: Setup reapplication timer like Dark Reader uses
    const reapplyInterval = setInterval(() => {
      if (!wrapper.isConnected && originalImg.isConnected && originalImg.parentElement) {
        originalImg.parentElement.insertBefore(wrapper, originalImg);
        originalImg.style.opacity = '0';
      } else if (!originalImg.isConnected) {
        // If original is gone, clean up
        clearInterval(reapplyInterval);
      }
    }, 500); // Check every 500ms
    
    // Clean up interval after 30 seconds (most page loads complete by then)
    setTimeout(() => {
      clearInterval(reapplyInterval);
    }, 30000);
    
    return wrapper;
  } catch (err) {
    debugError('Error in robustShadowReplace', err);
    // If anything fails, remove the marking so we can try again
    originalImg.removeAttribute('data-film-grade-robust-shadow');
    return null;
  }
};

// Resources and memory management to prevent leaks and excessive CPU usage
const processingResources = {
  activeObservers: new Set<MutationObserver | IntersectionObserver>(),
  activeTimers: new Set<NodeJS.Timeout>(),
  memoryUsage: 0,
  inProgressCount: 0,
  totalProcessed: 0,
  maxConcurrent: 5, // Maximum number of concurrent image processing operations
  
  // Register observers and timers so they can be cleaned up
  registerObserver(observer: MutationObserver | IntersectionObserver) {
    this.activeObservers.add(observer);
    return observer;
  },
  
  registerTimer(timerId: NodeJS.Timeout) {
    this.activeTimers.add(timerId);
    return timerId;
  },
  
  // Clean up a specific timer
  clearTimer(timerId: NodeJS.Timeout) {
    clearTimeout(timerId);
    this.activeTimers.delete(timerId);
  },
  
  // Clean up a specific observer
  clearObserver(observer: MutationObserver | IntersectionObserver) {
    observer.disconnect();
    this.activeObservers.delete(observer);
  },
  
  // Handle an image starting processing
  startProcessing() {
    this.inProgressCount++;
    return this.inProgressCount <= this.maxConcurrent;
  },
  
  // Handle an image completing processing
  finishProcessing() {
    this.inProgressCount--;
    this.totalProcessed++;
  },
  
  // Check if we should defer processing due to memory or CPU constraints
  shouldDeferProcessing() {
    return this.inProgressCount >= this.maxConcurrent;
  },
  
  // Clean up all resources (useful when extension is disabled or settings change)
  cleanupAllResources() {
    this.activeTimers.forEach(timer => clearTimeout(timer));
    this.activeObservers.forEach(observer => observer.disconnect());
    this.activeTimers.clear();
    this.activeObservers.clear();
    this.inProgressCount = 0;
    debugLog('Cleaned up all processing resources');
  }
};

// Use IntersectionObserver to lazily process images as they enter the viewport
const createLazyProcessor = (
  preset: string,
  enableGrain: boolean = false,
  enableVignette: boolean = false,
  isEnabled: boolean = true
) => {
  // Skip if not enabled or no preset selected
  if (!isEnabled || preset === 'none') return null;
  
  // Create the observer
  const lazyObserver = new IntersectionObserver((entries, observer) => {
    // Only process visible images
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      
      const element = entry.target as HTMLElement;
      
      // Skip if already processed or in progress
      if (element.dataset.filmGradeProcessed === 'true' ||
          element.getAttribute(PROCESSING_ATTRIBUTE) === 'true') {
        return;
      }
      
      // Check if we should defer processing due to resource constraints
      if (processingResources.shouldDeferProcessing()) {
        // Don't unobserve, we'll get another chance when resources free up
        return;
      }
      
      // Process the image based on its type
      if (element instanceof HTMLImageElement) {
        processImage(element, preset, enableGrain, enableVignette);
      } else {
        // For background images and other elements
        processBackgroundImage(element, preset, enableGrain, enableVignette);
      }
      
      // Stop observing this element
      observer.unobserve(element);
    });
  }, {
    rootMargin: '200px', // Start loading images before they enter the viewport
    threshold: 0.01 // Trigger with just 1% visibility
  });
  
  // Register for cleanup
  processingResources.registerObserver(lazyObserver);
  
  return lazyObserver;
};

// Add elements to lazy loading observer
const observeElementsLazily = (
  elements: HTMLElement[],
  observer: IntersectionObserver | null
) => {
  if (!observer) return;
  
  // Add all elements to the observer
  elements.forEach(element => {
    observer.observe(element);
  });
};

// Medium-specific image processor to handle their unique image loading mechanism
const processMediumImage = async (
  originalImgElement: HTMLImageElement,
  preset: string,
  enableGrain: boolean = false,
  enableVignette: boolean = false,
  forceReprocess: boolean = false
): Promise<void> => {
  if (!originalImgElement.src) {
    return;
  }

  // Skip if already being processed
  if (originalImgElement.getAttribute(PROCESSING_ATTRIBUTE) === 'true') {
    return;
  }

  try {
    // Mark as processing
    originalImgElement.setAttribute(PROCESSING_ATTRIBUTE, 'true');
    
    // Look for original source in Medium's attributes
    let originalSrc = originalImgElement.getAttribute('src');
    
    // Medium stores original image URLs in data-* attributes
    if (originalSrc && originalSrc.startsWith('data:')) {
      const dataSrc = originalImgElement.dataset.src;
      const origSrc = originalImgElement.dataset.origSrc;
      const actualSrc = originalImgElement.dataset.actualSrc;
      
      // Try all possible Medium source attributes
      originalSrc = dataSrc || origSrc || actualSrc || originalSrc;
    }
    
    if (!originalSrc) {
      originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
      return;
    }

    // Load the image with crossorigin="anonymous"
    const imageToProcess = await loadImageCrossOrigin(originalSrc);
    
    // Create a canvas to process the image
    const canvas = document.createElement('canvas');
    canvas.width = imageToProcess.naturalWidth;
    canvas.height = imageToProcess.naturalHeight;
    
    if (canvas.width === 0 || canvas.height === 0) {
      originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
      return;
    }
    
    // Draw the image on canvas
    ctx.drawImage(imageToProcess, 0, 0);
    
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (err) {
      originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
      return;
    }
    
    let processed = false;
    
    // Apply LUT if a preset is selected
    if (preset !== 'none') {
      try {
        const lutUrl = chrome.runtime.getURL(`assets/luts/${preset}.cube`);
        const response = await fetch(lutUrl);
        if (!response.ok) {
          throw new Error(`Failed to load LUT file: ${response.status}`);
        }
        
        const lutText = await response.text();
        const lut = parseCubeLUT(lutText, preset);
        
        if (lut.size === 0 || lut.data.length === 0) {
          throw new Error('Invalid LUT data');
        }
        
        const processedData = applyCubeLUT(imageData, lut);
        ctx.putImageData(processedData, 0, 0);
        processed = true;
      } catch (err) {
        debugError('LUT processing error', err);
      }
    }
    
    // Apply additional effects if enabled
    if (enableGrain) {
      applyGrain(ctx, canvas);
      processed = true;
    }
    
    if (enableVignette) {
      applyVignette(ctx, canvas);
      processed = true;
    }
    
    // Only update the image if processing succeeded
    if (processed) {
      // Generate data URL
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      
      // Keep track of the original src for potential reversion
      if (!originalImgElement.dataset.filmGradeOriginalSrc) {
        originalImgElement.dataset.filmGradeOriginalSrc = originalSrc;
      }
      
      // Replace the src directly - no need for property locking on Medium
      originalImgElement.src = dataUrl;
      
      // Mark as processed
      originalImgElement.dataset.filmGradeProcessed = 'true';
      
      // If this is in a picture element, disable source elements
      if (originalImgElement.parentElement?.tagName.toLowerCase() === 'picture') {
        const sources = originalImgElement.parentElement.querySelectorAll('source');
        sources.forEach(source => {
          if (source.srcset) {
            source.dataset.filmGradeOriginalSrcset = source.srcset;
            source.srcset = '';
          }
        });
      }
    }
  } catch (err) {
    debugError('Medium image processing error', err);
  } finally {
    // Remove processing attribute
    originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
  }
};
