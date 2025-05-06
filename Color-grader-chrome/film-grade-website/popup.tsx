import { useEffect, useState, useRef } from "react"
import "./style.css"

// Test image URL
const TEST_IMAGE_URL = "https://framerusercontent.com/images/5uFgFxdvtZUQ1BwVBRkyrOVkaSA.png"

function IndexPopup() {
  // State for filter settings
  const [preset, setPreset] = useState<string>("none")
  const [isEnabled, setIsEnabled] = useState<boolean>(true)
  const [enableGrain, setEnableGrain] = useState<boolean>(false)
  const [enableVignette, setEnableVignette] = useState<boolean>(false)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [debugInfo, setDebugInfo] = useState<string>("")
  const [processedImageSrc, setProcessedImageSrc] = useState<string>(TEST_IMAGE_URL)
  const [showTestImage, setShowTestImage] = useState<boolean>(false)
  
  // Refs for image processing
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // Available presets
  const presets = [
    { id: "none", name: "None" },
    { id: "fuji", name: "Fuji Film" },
    { id: "kodak", name: "Kodak Film" }
  ]

  // Load settings when the popup opens
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await chrome.storage.sync.get({
          preset: "none",
          enableGrain: false,
          enableVignette: false,
          isEnabled: true
        })

        setPreset(settings.preset)
        setEnableGrain(settings.enableGrain)
        setEnableVignette(settings.enableVignette)
        setIsEnabled(settings.isEnabled)
        setIsLoading(false)
      } catch (error) {
        console.error("Error loading settings:", error)
        setIsLoading(false)
        setDebugInfo(`Error loading settings: ${error}`)
      }
    }

    loadSettings()
  }, [])

  // Save settings and apply to the current tab
  const saveSettings = async () => {
    setIsLoading(true)
    setDebugInfo("Saving settings...")

    try {
      // Save to storage
      await chrome.storage.sync.set({
        preset,
        enableGrain,
        enableVignette,
        isEnabled
      })
      
      setDebugInfo("Settings saved. Sending refresh message...")

      // Get the current tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tabs[0]?.id) {
        try {
          // Send message to the content script
          await chrome.tabs.sendMessage(tabs[0].id, {
            action: "refresh"
          })
          setDebugInfo(`Refresh message sent to tab ${tabs[0].id}`)
        } catch (error) {
          setDebugInfo(`Error sending message: ${error}. This might mean the content script isn't loaded yet.`)
        }
      } else {
        setDebugInfo("No active tab found.")
      }
    } catch (error) {
      console.error("Error saving settings:", error)
      setDebugInfo(`Error saving settings: ${error}`)
    } finally {
      setIsLoading(false)
    }
  }
  
  // Manually inject the content script
  const injectContentScript = async () => {
    setDebugInfo("Manually injecting content script...")
    
    try {
      // Get the current tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tabs[0]?.id) {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            console.log("Film Grade: Manual content script injection attempt");
            // Add a marker to the document
            document.documentElement.dataset.filmGradeInjected = "true";
          }
        })
        setDebugInfo("Basic script injected. Now injecting main content script...")
        
        try {
          // Now try to run the full content script
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ['content.js']
          })
          setDebugInfo("Content script injected successfully. Try using the extension now.")
        } catch (e) {
          setDebugInfo(`Content script injection failed: ${e}. Try reloading the page.`)
        }
      } else {
        setDebugInfo("No active tab found.")
      }
    } catch (error) {
      setDebugInfo(`Error in injection process: ${error}`)
    }
  }
  
  // Debug function to directly apply filter
  const debugApplyFilter = async () => {
    setDebugInfo("Debug: Directly applying filter...")
    
    // Get the current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]?.id) {
      try {
        // Send direct message to apply filter
        await chrome.tabs.sendMessage(tabs[0].id, {
          action: "applyFilter",
          preset,
          enableGrain,
          enableVignette
        })
        setDebugInfo(`Direct filter application message sent to tab ${tabs[0].id}`)
      } catch (error) {
        setDebugInfo(`Error sending direct filter message: ${error}`)
      }
    }
  }
  
  // Check LUT file accessibility
  const debugCheckLutFile = async () => {
    if (preset === "none") {
      setDebugInfo("Select a preset first to check LUT file")
      return
    }
    
    setDebugInfo(`Checking LUT file for preset: ${preset}...`)
    
    try {
      const lutUrl = chrome.runtime.getURL(`assets/luts/${preset}.cube`)
      setDebugInfo(`LUT URL: ${lutUrl}`)
      
      const response = await fetch(lutUrl)
      if (response.ok) {
        const text = await response.text()
        setDebugInfo(`LUT file found! Size: ${text.length} bytes. First 50 chars: ${text.substring(0, 50)}...`)
      } else {
        setDebugInfo(`Failed to load LUT file: ${response.status} ${response.statusText}`)
      }
    } catch (error) {
      setDebugInfo(`Error accessing LUT file: ${error}`)
    }
  }

  // Check content script status
  const debugCheckContentScript = async () => {
    setDebugInfo("Checking content script status...")
    
    // Get the current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]?.id) {
      try {
        // Send ping message
        await chrome.tabs.sendMessage(tabs[0].id, { action: "ping" })
        setDebugInfo("Content script is active!")
      } catch (error) {
        setDebugInfo(`Content script not responding: ${error}. You might need to reload the page or use the 'Force Inject Content Script' button.`)
      }
    } else {
      setDebugInfo("No active tab found.")
    }
  }
  
  // Reload the page
  const reloadPage = async () => {
    setDebugInfo("Reloading the current page...")
    
    // Get the current tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]?.id) {
      try {
        // Reload the tab
        await chrome.tabs.reload(tabs[0].id)
        setDebugInfo("Page is reloading. Wait a moment and then check the content script status.")
      } catch (error) {
        setDebugInfo(`Error reloading page: ${error}`)
      }
    } else {
      setDebugInfo("No active tab found.")
    }
  }
  
  // Process test image with current settings
  const processTestImage = async () => {
    setDebugInfo("Processing test image...")
    
    const img = imgRef.current
    const canvas = canvasRef.current
    
    if (!img || !canvas || !img.complete) {
      setDebugInfo("Test image not ready yet.")
      return
    }
    
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        setDebugInfo("Failed to get canvas context.")
        return
      }
      
      // Set canvas size to match image
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      
      // Draw the image
      ctx.drawImage(img, 0, 0)
      
      // If no preset is selected or extension is disabled, just show the original
      if (preset === "none" || !isEnabled) {
        setProcessedImageSrc(TEST_IMAGE_URL)
        setDebugInfo("No preset selected or extension disabled. Showing original image.")
        return
      }
      
      // Get LUT and apply it
      try {
        const lutUrl = chrome.runtime.getURL(`assets/luts/${preset}.cube`)
        const response = await fetch(lutUrl)
        if (!response.ok) {
          throw new Error(`Failed to load LUT file: ${response.status}`)
        }
        
        const lutText = await response.text()
        const lut = parseCubeLUT(lutText)
        
        if (!lut || lut.size === 0 || lut.data.length === 0) {
          throw new Error("Invalid LUT data")
        }
        
        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        
        // Apply LUT
        const processedData = applyCubeLUT(imageData, lut)
        ctx.putImageData(processedData, 0, 0)
        
        // Apply additional effects if enabled
        if (enableGrain) {
          applyGrain(ctx, canvas)
        }
        
        if (enableVignette) {
          applyVignette(ctx, canvas)
        }
        
        // Convert to data URL and update image
        const dataUrl = canvas.toDataURL('image/png')
        setProcessedImageSrc(dataUrl)
        setDebugInfo(`Test image processed with ${preset} preset${enableGrain ? ", grain" : ""}${enableVignette ? ", vignette" : ""}.`)
      } catch (error) {
        setDebugInfo(`Error processing test image: ${error}`)
        setProcessedImageSrc(TEST_IMAGE_URL) // Revert to original on error
      }
    } catch (error) {
      setDebugInfo(`Error in test image processing: ${error}`)
    }
  }
  
  // Toggle test image visibility
  const toggleTestImage = () => {
    setShowTestImage(!showTestImage)
    if (!showTestImage) {
      // When showing the test image, process it
      setTimeout(processTestImage, 500) // Short delay to ensure image is loaded
    }
  }
  
  // Parse CUBE LUT files
  const parseCubeLUT = (text: string) => {
    const lines = text.split('\n')
    const lut = { size: 0, data: [] as number[][] }
    
    for (const line of lines) {
      const trimmed = line.trim()
      
      // Skip comments and empty lines
      if (trimmed.startsWith('#') || trimmed === '') {
        continue
      }
      
      // Parse LUT size
      if (trimmed.startsWith('LUT_3D_SIZE')) {
        lut.size = parseInt(trimmed.split(/\s+/)[1], 10)
        continue
      }
      
      // Parse RGB values
      const values = trimmed.split(/\s+/).map(Number)
      if (values.length === 3) {
        lut.data.push(values)
      }
    }
    
    return lut
  }
  
  // Apply LUT to image data
  const applyCubeLUT = (imageData: ImageData, lut: { size: number, data: number[][] }) => {
    const { data, width, height } = imageData
    const result = new ImageData(width, height)
    const resultData = result.data
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255
      
      // Find closest LUT indices
      const size = lut.size
      const x = Math.floor(r * (size - 1)) // R-index
      const y = Math.floor(g * (size - 1)) // G-index
      const z = Math.floor(b * (size - 1)) // B-index
      
      // Get index in the flattened LUT array
      // Corrected for B-fastest, G-medium, R-slowest LUT data order
      const idx = z + y * size + x * size * size; 
      
      // Apply LUT transformation
      if (idx >= 0 && idx < lut.data.length) {
        resultData[i] = Math.round(lut.data[idx][0] * 255)
        resultData[i + 1] = Math.round(lut.data[idx][1] * 255)
        resultData[i + 2] = Math.round(lut.data[idx][2] * 255)
      } else {
        // Fallback if index is out of range
        resultData[i] = data[i]
        resultData[i + 1] = data[i + 1]
        resultData[i + 2] = data[i + 2]
        console.warn(`Film Grade: LUT index ${idx} out of bounds (max: ${lut.data.length-1}). LutSize: ${size}, Input RGB: (${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)}) -> Indices (x,y,z): (${x},${y},${z})`);
      }
      resultData[i + 3] = data[i + 3] // Keep original alpha
    }
    
    return result
  }
  
  // Apply grain effect
  const applyGrain = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, intensity: number = 0.1) => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    
    for (let i = 0; i < data.length; i += 4) {
      // Generate random noise
      const noise = (Math.random() - 0.5) * intensity * 255
      
      // Apply noise to RGB channels
      data[i] = Math.min(255, Math.max(0, data[i] + noise))
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise))
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise))
    }
    
    ctx.putImageData(imageData, 0, 0)
  }
  
  // Apply vignette effect
  const applyVignette = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, amount: number = 0.3) => {
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const radius = Math.max(centerX, centerY) * 0.8
    
    // Create radial gradient
    const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.7, centerX, centerY, radius)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(1, `rgba(0, 0, 0, ${amount})`)
    
    // Apply gradient
    ctx.globalCompositeOperation = 'overlay'
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'source-over'
  }

  // Handle preset change
  const handlePresetChange = (newPreset: string) => {
    setPreset(newPreset)
    if (showTestImage) {
      setTimeout(processTestImage, 100)
    }
  }

  // Handle toggle
  const handleToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target

    switch (name) {
      case "isEnabled":
        setIsEnabled(checked)
        break
      case "enableGrain":
        setEnableGrain(checked)
        break
      case "enableVignette":
        setEnableVignette(checked)
        break
    }
    
    if (showTestImage) {
      setTimeout(processTestImage, 100)
    }
  }

  // Save when settings change
  useEffect(() => {
    if (!isLoading) {
      saveSettings()
    }
  }, [preset, enableGrain, enableVignette, isEnabled])

  return (
    <div className="popup-container">
      <div className="header">
        <h1>Film Grade</h1>
        <div className="toggle-container">
          <label className="toggle">
            <input
              type="checkbox"
              name="isEnabled"
              checked={isEnabled}
              onChange={handleToggle}
            />
            <span className="slider round"></span>
          </label>
          <span className="toggle-label">{isEnabled ? "On" : "Off"}</span>
        </div>
      </div>

      <div className="settings-container" style={{ opacity: isEnabled ? 1 : 0.5 }}>
        <div className="preset-section">
          <h2>Presets</h2>
          <div className="preset-grid">
            {presets.map((p) => (
              <div
                key={p.id}
                className={`preset-item ${preset === p.id ? "selected" : ""}`}
                onClick={() => isEnabled && handlePresetChange(p.id)}
              >
                {p.name}
              </div>
            ))}
          </div>
        </div>

        <div className="effects-section">
          <h2>Effects</h2>
          <div className="effect-options">
            <label className="effect-option">
              <input
                type="checkbox"
                name="enableGrain"
                checked={enableGrain}
                onChange={handleToggle}
                disabled={!isEnabled || preset === "none"}
              />
              Film Grain
            </label>

            <label className="effect-option">
              <input
                type="checkbox"
                name="enableVignette"
                checked={enableVignette}
                onChange={handleToggle}
                disabled={!isEnabled || preset === "none"}
              />
              Vignette
            </label>
          </div>
        </div>
        
        <div className="test-image-toggle">
          <button onClick={toggleTestImage}>
            {showTestImage ? "Hide Test Image" : "Show Test Image"}
          </button>
        </div>
        
        {showTestImage && (
          <div className="test-image-section">
            <h2>Test Image Preview</h2>
            <div className="test-image-container">
              <img 
                src={processedImageSrc}
                alt="Test" 
                className="test-image" 
              />
              <img 
                ref={imgRef}
                src={TEST_IMAGE_URL}
                alt="Original"
                className="hidden"
                onLoad={processTestImage}
              />
              <canvas ref={canvasRef} className="hidden" />
              <button onClick={processTestImage} className="process-button">
                Process
              </button>
            </div>
          </div>
        )}
        
        <div className="debug-section">
          <h2>Debug Tools</h2>
          <div className="debug-buttons">
            <button onClick={debugCheckContentScript}>Check Content Script</button>
            <button onClick={injectContentScript} className="warning">Force Inject Content Script</button>
            <button onClick={reloadPage}>Reload Page</button>
            <button onClick={debugCheckLutFile}>Check LUT File</button>
            <button onClick={debugApplyFilter}>Apply Filter Directly</button>
          </div>
          <div className="debug-info">
            {debugInfo && <pre>{debugInfo}</pre>}
          </div>
        </div>
      </div>

      <div className="footer">
        <p>Apply film-like color grading to images on the web</p>
      </div>
    </div>
  )
}

export default IndexPopup