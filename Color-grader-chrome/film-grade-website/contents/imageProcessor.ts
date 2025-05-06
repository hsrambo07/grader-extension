// Add a debug mode flag at the top of the file
const DEBUG_MODE = false; // Set to true only during development

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
      // If src is empty or null, reject immediately.
      if (DEBUG_MODE) {
        console.warn('Film Grade: loadImageCrossOrigin called with empty src.');
      }
      reject(new Error('Image source is empty.'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => {
      // Only log error details in debug mode
      if (DEBUG_MODE) {
        let errorDetails = 'Unknown error';
        if (typeof err === 'string') {
          errorDetails = err;
        } else if (err instanceof Event) {
          errorDetails = `Event type: ${err.type}`;
        }
        console.error(`Film Grade: Failed to load image cross-origin: ${src}. Error: ${errorDetails}`);
      }
      reject(new Error(`Failed to load image ${src} for canvas processing`));
    };
    try {
      img.src = src;
    } catch (e) {
      // Catch potential errors if src is invalid (e.g., malformed URL)
      if (DEBUG_MODE) {
        console.error(`Film Grade: Error setting img.src for ${src}`);
      }
      reject(new Error(`Error setting img.src for ${src}`));
    }
  });
};

// Add optimization flags to control how aggressive the extension is
const CONFIG = {
  // Maximum number of images to process in one page
  MAX_IMAGES_TO_PROCESS: 100, // Increased from 30 to 100
  // Skip images smaller than this size (width or height in pixels)
  MIN_IMAGE_SIZE: 40,
  // Process images larger than this size last (width or height in pixels)
  LARGE_IMAGE_SIZE: 150,
  // Maximum canvas size to prevent memory issues
  MAX_CANVAS_DIMENSION: 2000,
  // Batch size for processing
  BATCH_SIZE: 5,
  // Batch delay between batches (ms)
  BATCH_DELAY: 100,
  // How frequently to check for new content (ms)
  CONTENT_CHECK_INTERVAL: 3000
};

// Add a more visible progress indicator in the corner of the page
const setupGlobalIndicator = () => {
  if (!document.getElementById('film-grade-global-indicator')) {
    const indicator = document.createElement('div');
    indicator.id = 'film-grade-global-indicator';
    indicator.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background-color: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: sans-serif;
      font-size: 12px;
      z-index: 99999;
      display: none;
      pointer-events: none;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    `;
    document.body.appendChild(indicator);
  }
  return document.getElementById('film-grade-global-indicator');
};

// Show/hide the global indicator
const updateGlobalIndicator = (visible: boolean, message: string = '') => {
  const indicator = setupGlobalIndicator();
  if (visible) {
    indicator.style.display = 'block';
    indicator.textContent = message;
  } else {
    indicator.style.display = 'none';
  }
};

// Cache for already processed URLs to avoid redundant work
const processedUrlCache = new Set<string>();

// Define the media elements result interface for better type safety
interface MediaElements {
  regular: HTMLElement[];
  large: HTMLElement[];
}

// Find all media assets to process (images, videos, canvas)
// This is the function causing the issue - we need to make it more robust
function findMediaElements(): MediaElements {
  // More efficient selectors to find media elements
  const regularElements: HTMLElement[] = [];
  const largeElements: HTMLElement[] = [];
  
  // Find visible images that are large enough to be worth processing
  const imageSelector = 'img:not([aria-hidden="true"]):not([role="presentation"]):not([data-film-grade-skip]):not([data-film-grade-processed])';
  const images = document.querySelectorAll(imageSelector);
  
  let imageCount = 0;
  images.forEach((img) => {
    const imgEl = img as HTMLImageElement;
    
    // Skip if already at our limit
    if (imageCount >= CONFIG.MAX_IMAGES_TO_PROCESS) return;
    
    // Skip if too small (below MIN_IMAGE_SIZE) or SVG
    if (isSVGorVector(imgEl)) return;
    
    // Check if image is visible and large enough to be worth processing
    const rect = imgEl.getBoundingClientRect();
    if (rect.width < CONFIG.MIN_IMAGE_SIZE || rect.height < CONFIG.MIN_IMAGE_SIZE) {
      return;
    }
    
    // Check if image is in viewport or close to it
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;
    
    // Is it in or near the viewport?
    const vertInView = (rect.top <= windowHeight + 1000 && rect.bottom >= -1000);
    const horInView = (rect.left <= windowWidth + 1000 && rect.right >= -1000);
    
    if (vertInView && horInView) {
      // Check if this is a large image to process later
      if (rect.width > CONFIG.LARGE_IMAGE_SIZE || rect.height > CONFIG.LARGE_IMAGE_SIZE) {
        largeElements.push(imgEl);
      } else {
        regularElements.push(imgEl);
      }
      imageCount++;
    }
  });
  
  // Be more selective with background images too
  if (imageCount < CONFIG.MAX_IMAGES_TO_PROCESS) {
    const bgContainers = document.querySelectorAll('div[style*="background-image"]:not([data-film-grade-skip]):not([data-film-grade-processed])');
    
    bgContainers.forEach((el) => {
      // Skip if already at our limit
      if (imageCount >= CONFIG.MAX_IMAGES_TO_PROCESS) return;
      
      const element = el as HTMLElement;
      const style = window.getComputedStyle(element);
      
      if (style.backgroundImage && 
          style.backgroundImage !== 'none' && 
          !style.backgroundImage.includes('svg') && 
          element.offsetWidth > CONFIG.MIN_IMAGE_SIZE && 
          element.offsetHeight > CONFIG.MIN_IMAGE_SIZE) {
        
        // Check if in viewport like we did with images
        const rect = element.getBoundingClientRect();
        const windowHeight = window.innerHeight || document.documentElement.clientHeight;
        const windowWidth = window.innerWidth || document.documentElement.clientWidth;
        
        const vertInView = (rect.top <= windowHeight + 1000 && rect.bottom >= -1000);
        const horInView = (rect.left <= windowWidth + 1000 && rect.right >= -1000);
        
        if (vertInView && horInView) {
          // Check if this is a large element to process later
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
  
  return { regular: regularElements, large: largeElements };
}

// Create a backward-compatible version that returns a flat array
// This will be our fallback for minified code
function findAllMediaElements(): HTMLElement[] {
  try {
    // Try to use the structured function first
    const result = findMediaElements();
    // Check if we got a valid result with arrays
    if (result && Array.isArray(result.regular) && Array.isArray(result.large)) {
      return [...result.regular, ...result.large];
    }
  } catch (e) {
    debugError('Error in findMediaElements', e);
  }
  
  // Fallback implementation if the main function fails or returns unexpected format
  const elements: HTMLElement[] = [];
  
  // Find images
  const images = document.querySelectorAll('img:not([data-film-grade-processed])');
  images.forEach(img => {
    const imgEl = img as HTMLImageElement;
    if (imgEl.width >= CONFIG.MIN_IMAGE_SIZE && imgEl.height >= CONFIG.MIN_IMAGE_SIZE) {
      elements.push(imgEl);
    }
  });
  
  // Find background images
  const bgElements = document.querySelectorAll('div[style*="background-image"]:not([data-film-grade-processed])');
  bgElements.forEach(el => {
    elements.push(el as HTMLElement);
  });
  
  return elements;
}

// Make the function globally available to prevent bundler issues
window.findMediaElements = findMediaElements;
window.findAllMediaElements = findAllMediaElements;

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
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    
    // Find closest LUT indices
    const size = lut.size;
    const x = Math.floor(r * (size - 1)); // R-index
    const y = Math.floor(g * (size - 1)); // G-index
    const z = Math.floor(b * (size - 1)); // B-index
    
    // Get index in the flattened LUT array
    // Corrected for B-fastest, G-medium, R-slowest LUT data order
    const idx = z + y * size + x * size * size; 
    
    // Apply LUT transformation
    if (idx >= 0 && idx < lut.data.length) {
      resultData[i] = Math.round(lut.data[idx][0] * 255);
      resultData[i + 1] = Math.round(lut.data[idx][1] * 255);
      resultData[i + 2] = Math.round(lut.data[idx][2] * 255);
    } else {
      // Fallback if index is out of range
      resultData[i] = data[i];
      resultData[i + 1] = data[i + 1];
      resultData[i + 2] = data[i + 2];
      // Only warn in debug mode and very occasionally to avoid console spam
      if (DEBUG_MODE && Math.random() < 0.001) { // Reduced from 0.01 to 0.001
        console.warn(`Film Grade: LUT index out of bounds (${idx}/${lut.data.length-1})`);
      }
    }
    resultData[i + 3] = data[i + 3]; // Keep original alpha
  }
  
  return result;
};

// Apply grain effect
const applyGrain = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, intensity: number = 0.1) => {
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

// Process an image with the selected preset and effects
const processImage = async (
  originalImgElement: HTMLImageElement,
  preset: string,
  enableGrain: boolean = false,
  enableVignette: boolean = false,
  forceReprocess: boolean = false
): Promise<void> => {
  if (!originalImgElement.src) {
    return;
  }

  const originalSrcAttr = originalImgElement.getAttribute('src');
  const processedSrc = originalImgElement.dataset.filmGradeOriginalSrc;
  const cacheKey = `${originalSrcAttr}-${preset}-${enableGrain ? 1 : 0}-${enableVignette ? 1 : 0}`;

  // Skip if already processed with same settings or in cache
  if (!forceReprocess && 
      ((processedSrc && processedSrc === originalSrcAttr) ||
       processedUrlCache.has(cacheKey) ||
       originalImgElement.hasAttribute('data-film-grade-processed'))) {
    return;
  }

  // If already being processed, skip
  if (originalImgElement.getAttribute(PROCESSING_ATTRIBUTE) === 'true') {
    return;
  }

  try {
    // Mark as processing and show loading indicator
    originalImgElement.setAttribute(PROCESSING_ATTRIBUTE, 'true');
    
    // Load the image with crossorigin="anonymous" to avoid tainting the canvas
    const imageToProcess = await loadImageCrossOrigin(originalSrcAttr!);
    
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
      // Use lower quality for performance
      originalImgElement.src = canvas.toDataURL('image/jpeg', 0.85); 
      originalImgElement.dataset.filmGradeOriginalSrc = originalSrcAttr!;
      // Add to cache to prevent redundant processing
      processedUrlCache.add(cacheKey);
      // Mark as processed to avoid finding it again
      originalImgElement.setAttribute('data-film-grade-processed', 'true');
    } else {
      if (originalImgElement.src.startsWith('data:image') && originalImgElement.dataset.filmGradeOriginalSrc) {
         originalImgElement.src = originalImgElement.dataset.filmGradeOriginalSrc;
      }
      delete originalImgElement.dataset.filmGradeOriginalSrc;
    }
  } catch (err) {
    // Silent fail
    if (originalImgElement.dataset.filmGradeOriginalSrc && originalImgElement.src !== originalImgElement.dataset.filmGradeOriginalSrc) {
        originalImgElement.src = originalImgElement.dataset.filmGradeOriginalSrc;
    }
  } finally {
    // Always remove processing attribute regardless of outcome
    originalImgElement.removeAttribute(PROCESSING_ATTRIBUTE);
  }
};

// Process a background image
const processBackgroundImage = async (
  element: HTMLElement,
  preset: string,
  enableGrain: boolean = false,
  enableVignette: boolean = false,
  forceReprocess: boolean = false
): Promise<void> => {
  const style = window.getComputedStyle(element);
  const bgImageStyle = style.backgroundImage;
  
  const match = bgImageStyle.match(/url\(['"]?(.*?)['"]?\)/);
  if (!match || !match[1]) {
    return;
  }
  
  const imageUrl = match[1];
  if (!imageUrl || imageUrl === 'none' || imageUrl.trim() === '') {
    return;
  }

  const processedUrl = element.dataset.filmGradeOriginalSrc;
  const cacheKey = `${imageUrl}-${preset}-${enableGrain ? 1 : 0}-${enableVignette ? 1 : 0}`;
  
  // Skip if already processed with same settings or in cache
  if (!forceReprocess && 
      ((processedUrl && processedUrl === imageUrl) ||
       processedUrlCache.has(cacheKey))) {
    return;
  }

  // If already being processed, skip
  if (element.getAttribute(PROCESSING_ATTRIBUTE) === 'true') {
    return;
  }

  try {
    // Mark as processing and show loading indicator
    element.setAttribute(PROCESSING_ATTRIBUTE, 'true');
    
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
      const dataUrl = canvas.toDataURL();
      element.style.backgroundImage = `url('${dataUrl}')`;
      element.dataset.filmGradeOriginalSrc = imageUrl;
      // Add to cache to prevent redundant processing
      processedUrlCache.add(cacheKey);
    } else {
      if (element.style.backgroundImage.startsWith('url("data:image') && element.dataset.filmGradeOriginalSrc) {
          element.style.backgroundImage = `url('${element.dataset.filmGradeOriginalSrc}')`;
      }
      delete element.dataset.filmGradeOriginalSrc;
    }
  } catch (err) {
    // Silent fail in production mode
    debugError('Processing error for background', err);
    
    if (element.dataset.filmGradeOriginalSrc && element.style.backgroundImage !== `url('${element.dataset.filmGradeOriginalSrc}')`) {
        element.style.backgroundImage = `url('${element.dataset.filmGradeOriginalSrc}')`;
    }
  } finally {
    // Always remove processing attribute regardless of outcome
    element.removeAttribute(PROCESSING_ATTRIBUTE);
  }

  // Add data-film-grade-processed at the end
  element.setAttribute('data-film-grade-processed', 'true');
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

// Function to revert a single element to its original state
const revertElement = (element: HTMLElement) => {
    if (element instanceof HTMLImageElement) {
        const originalSrc = element.dataset.filmGradeOriginalSrc;
        if (originalSrc && element.src !== originalSrc) {
            element.src = originalSrc;
        }
        delete element.dataset.filmGradeOriginalSrc;
    } else if (element.style.backgroundImage.startsWith('url("data:image')) {
        const originalSrc = element.dataset.filmGradeOriginalSrc;
        if (originalSrc && element.style.backgroundImage !== `url('${originalSrc}')`) {
            element.style.backgroundImage = `url('${originalSrc}')`;
        }
        delete element.dataset.filmGradeOriginalSrc;
    }
    element.removeAttribute(PROCESSING_ATTRIBUTE);
};

// Process all media elements on the page with throttling
const processAllMedia = async (
  preset: string, 
  enableGrain: boolean = false, 
  enableVignette: boolean = false,
  isEnabled: boolean = true,
  forceReprocessAll: boolean = false
): Promise<void> => {
  // Setup global progress indicator
  updateGlobalIndicator(true, 'Preparing Film Grade...');
  
  // Ensure loading styles are set up
  setupLoadingStyles();
  
  const { regular, large } = findMediaElements();
  const allMediaElements = [...regular, ...large]; // Combined for reverting if needed
  
  if (!isEnabled || preset === 'none') {
    // Revert all elements if needed
    for (const element of allMediaElements) {
      revertElement(element);
    }
    lastAppliedSettings = { preset: '', enableGrain: false, enableVignette: false, isEnabled: false };
    updateGlobalIndicator(false);
    return;
  }
  
  if (allMediaElements.length === 0) {
    updateGlobalIndicator(false);
    
    // Even if no elements found now, schedule another check if enabled
    if (isEnabled && preset !== 'none') {
      setTimeout(() => {
        // If settings haven't changed, try processing again
        if (lastAppliedSettings.isEnabled === isEnabled && 
            lastAppliedSettings.preset === preset &&
            lastAppliedSettings.enableGrain === enableGrain &&
            lastAppliedSettings.enableVignette === enableVignette) {
          processAllMedia(preset, enableGrain, enableVignette, isEnabled, false);
        }
      }, CONFIG.CONTENT_CHECK_INTERVAL);
    }
    return;
  }
  
  let imageCount = 0;
  let bgCount = 0;
  let otherCount = 0;
  let largeImageCount = 0;
  
  // Process in batches - first regular images, then large ones
  const batchSize = CONFIG.BATCH_SIZE;
  
  // Process regular images first
  let currentRegularBatch = 0;
  const totalRegularBatches = Math.ceil(regular.length / batchSize);
  
  // Process large images second
  let currentLargeBatch = 0;
  const totalLargeBatches = Math.ceil(large.length / batchSize);
  
  // Calculate total batches
  const totalBatches = totalRegularBatches + totalLargeBatches;
  
  // Determine if this element needs reprocessing
  const forceElementReprocess = forceReprocessAll || 
                               preset !== lastAppliedSettings.preset || 
                               enableGrain !== lastAppliedSettings.enableGrain || 
                               enableVignette !== lastAppliedSettings.enableVignette;
  
  // Process regular sized images first
  const processRegularBatch = async () => {
    if (regular.length === 0 || currentRegularBatch * batchSize >= regular.length) {
      // Start processing large images once all regular images are done
      processLargeBatch();
      return;
    }
    
    const startIdx = currentRegularBatch * batchSize;
    const endIdx = Math.min(startIdx + batchSize, regular.length);
    
    // Update global indicator to show we're processing regular images
    const overallProgress = Math.round((currentRegularBatch / totalBatches) * 100);
    updateGlobalIndicator(true, `Processing regular images: ${overallProgress}%`);
    
    for (let i = startIdx; i < endIdx; i++) {
      const element = regular[i];
      
      if (element instanceof HTMLImageElement) {
        await processImage(element, preset, enableGrain, enableVignette, forceElementReprocess);
        imageCount++;
      } else if (element.style && element.style.backgroundImage && element.style.backgroundImage.includes('url')) {
        await processBackgroundImage(element, preset, enableGrain, enableVignette, forceElementReprocess);
        bgCount++;
      } else {
        otherCount++;
      }
    }
    
    // Process next batch of regular images
    currentRegularBatch++;
    if (currentRegularBatch * batchSize < regular.length) {
      setTimeout(processRegularBatch, CONFIG.BATCH_DELAY);
    } else {
      // Start processing large images once all regular images are done
      processLargeBatch();
    }
  };
  
  // Process large images after regular images
  const processLargeBatch = async () => {
    if (large.length === 0 || currentLargeBatch * batchSize >= large.length) {
      // All processing complete
      finishProcessing();
      return;
    }
    
    const startIdx = currentLargeBatch * batchSize;
    const endIdx = Math.min(startIdx + batchSize, large.length);
    
    // Update global indicator to show we're now processing large images
    const overallProgress = Math.round(((totalRegularBatches + currentLargeBatch) / totalBatches) * 100);
    updateGlobalIndicator(true, `Processing large images: ${overallProgress}%`);
    
    for (let i = startIdx; i < endIdx; i++) {
      const element = large[i];
      
      if (element instanceof HTMLImageElement) {
        await processImage(element, preset, enableGrain, enableVignette, forceElementReprocess);
        largeImageCount++;
      } else if (element.style && element.style.backgroundImage && element.style.backgroundImage.includes('url')) {
        await processBackgroundImage(element, preset, enableGrain, enableVignette, forceElementReprocess);
        bgCount++;
      } else {
        otherCount++;
      }
    }
    
    // Process next batch of large images
    currentLargeBatch++;
    if (currentLargeBatch * batchSize < large.length) {
      setTimeout(processLargeBatch, CONFIG.BATCH_DELAY);
    } else {
      // All processing complete
      finishProcessing();
    }
  };
  
  // Finish processing and clean up
  const finishProcessing = () => {
    lastAppliedSettings = { preset, enableGrain, enableVignette, isEnabled };
    
    // Show completion message with counts
    updateGlobalIndicator(true, `Processing complete. Regular: ${imageCount}, Large: ${largeImageCount}`);
    
    // Hide the indicator after a delay
    setTimeout(() => {
      updateGlobalIndicator(false);
      
      // Schedule another check after completion to catch any new images that appeared during processing
      if (isEnabled && preset !== 'none') {
        setTimeout(() => {
          checkForNewContent(preset, enableGrain, enableVignette, isEnabled);
        }, CONFIG.CONTENT_CHECK_INTERVAL);
      }
    }, 1500);
  };
  
  // Start with regular images
  processRegularBatch();
};

// Add a function to periodically check for new content
const checkForNewContent = async (
  preset: string,
  enableGrain: boolean,
  enableVignette: boolean, 
  isEnabled: boolean
) => {
  if (!isEnabled || preset === 'none') return;
  
  // Find any unprocessed media elements
  const { regular, large } = findMediaElements();
  
  // If we find new unprocessed elements, process them
  if (regular.length > 0 || large.length > 0) {
    debugLog(`Found new content to process: ${regular.length + large.length} elements`);
    await processAllMedia(preset, enableGrain, enableVignette, isEnabled, false);
  } else {
    // Schedule another check later
    setTimeout(() => {
      checkForNewContent(preset, enableGrain, enableVignette, isEnabled);
    }, CONFIG.CONTENT_CHECK_INTERVAL);
  }
};

// Process new elements added to the DOM via MutationObserver
const observeDOM = (settings: { preset: string, enableGrain: boolean, enableVignette: boolean, isEnabled: boolean }) => {
  // Create a more efficient mutation handler
  const throttledHandleMutation = throttleProcessing(() => {
    if (settings.isEnabled && settings.preset !== 'none') {
      processAllMedia(settings.preset, settings.enableGrain, settings.enableVignette, settings.isEnabled, false);
    }
  }, 500); // Reduced from 1000ms to 500ms to be more responsive
  
  const observer = new MutationObserver((mutations) => {
    let mediaAdded = false;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement) {
            // Quick check for media elements
            if (
              node instanceof HTMLImageElement || 
              node instanceof HTMLVideoElement ||
              (node.style && node.style.backgroundImage && node.style.backgroundImage !== '')
            ) {
              mediaAdded = true;
              break; // Found media, no need to check more nodes
            }
            
            // Check for potential media children, but only check once
            if (!mediaAdded && node.querySelectorAll) {
              const childMediaCount = node.querySelectorAll('img, video, [style*="background-image"]').length;
              if (childMediaCount > 0) {
                mediaAdded = true;
                break;
              }
            }
          }
        }
        
        if (mediaAdded) break; // Found media, no need to check more mutations
      }
    }
    
    // Process new media if found, but throttled
    if (mediaAdded) {
      throttledHandleMutation();
    }
  });
  
  // Start observing with more aggressive options
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true, // Add attributes monitoring to catch when imgs load
    attributeFilter: ['src', 'style'] // Only watch for src and style changes
  });
  
  return observer;
};

// Store the active observer reference
let activeObserver: MutationObserver | null = null;

// Initialize the content script
const initializeProcessor = async () => {
  debugLog('Initializing...');
  
  // Set up CSS for loading indicators
  setupLoadingStyles();
  
  const settings = await getFilterSettings();
  lastAppliedSettings = { ...settings };

  try {
    // Apply initial filtering only if enabled and a preset is chosen
    if (settings.isEnabled && settings.preset !== 'none') {
      debugLog(`Applying initial filter: ${settings.preset}`);
      await processAllMedia(settings.preset, settings.enableGrain, settings.enableVignette, settings.isEnabled, true);
      
      // Start periodic checks for new content
      setTimeout(() => {
        checkForNewContent(settings.preset, settings.enableGrain, settings.enableVignette, settings.isEnabled);
      }, CONFIG.CONTENT_CHECK_INTERVAL);
    } else {
      // Revert any existing processed images if starting disabled
      const allElements = findAllMediaElements();
      
      for (const element of allElements) {
        revertElement(element);
      }
    }
  } catch (e) {
    debugError('Error during initialization', e);
  }
  
  // Stop any existing observers
  if (activeObserver) {
    activeObserver.disconnect();
    activeObserver = null;
  }
  
  // Start new observer
  activeObserver = observeDOM(settings);
  
  debugLog('Initialization complete');
};

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
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeProcessor);
} else {
    initializeProcessor();
}

// Process refreshes in a way that works with the bundled code
// This avoids the "findMediaElements is not a function" error
const refreshHandler = async () => {
  try {
    const settings = await getFilterSettings();
    
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
    
    if (settings.isEnabled && settings.preset !== 'none') {
      // Get all media elements with our safe function
      const mediaElements = findAllMediaElements();
      
      // Process each element individually
      for (let i = 0; i < mediaElements.length; i++) {
        const element = mediaElements[i];
        if (element instanceof HTMLImageElement) {
          await processImage(element, settings.preset, settings.enableGrain, settings.enableVignette, true);
        } else if (element.style && element.style.backgroundImage && element.style.backgroundImage.includes('url')) {
          await processBackgroundImage(element, settings.preset, settings.enableGrain, settings.enableVignette, true);
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