import { useState, useEffect } from 'react';
import 'tldraw/tldraw.css';
import { PdfEditor } from './PdfEditor';
import { Pdf, PdfPage } from './PdfPicker';
import { AssetRecordType, Box, createShapeId } from 'tldraw';
import './pdf-editor.css';

type EditorType = 'pdf' | 'whiteboard';

type EditorConfig = {
  type: EditorType;
  pdfUrl?: string;
  path?: string;
};

type State =
  | {
      phase: 'loading';
    }
  | {
      phase: 'edit';
      config: EditorConfig;
      pdf?: Pdf;
      state_url?: string;
    };

interface PageImage {
  url: string;
  expires_at: number;
}

// Function to update URLs in the state data
function updateStateUrls(base64State: string, pageImages: PageImage[]): string {
  try {
    // Get the base64 part after the prefix
    const base64Data = base64State.replace('data:application/json;base64,', '');
    
    // Decode and parse
    const jsonStr = atob(base64Data);
    const state = JSON.parse(jsonStr);

    // Update each asset URL
    pageImages.forEach((pageImage, index) => {
      const assetId = `asset:uflo_pdf_page_${index + 1}`;
      if (state.document?.store?.[assetId]) {
        state.document.store[assetId].props.src = pageImage.url;
      }
    });

    // Convert back to base64 with the same prefix
    return `data:application/json;base64,${btoa(JSON.stringify(state))}`;
  } catch (error) {
    console.error('Failed to update state URLs:', error);
    return base64State; // Return original if update fails
  }
}

const pageSpacing = 32;

// Initialize from pre-rendered page images
async function initializeFromPageImages(pageImages: PageImage[]): Promise<Pdf> {
  const pages: PdfPage[] = [];
  let top = 0;
  let widest = 0;

  // Create a temporary image to get dimensions
  const img = new Image();
  const loadImage = (url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  };

  for (let i = 0; i < pageImages.length; i++) {
    const pageImage = pageImages[i];
    await loadImage(pageImage.url);
    
    const width = img.width;
    const height = img.height;
    
    // Create a deterministic asset ID that we can predict later
    const assetId = AssetRecordType.createId(`uflo_pdf_page_${i + 1}`);
    
    pages.push({
      pageId: `page-${i + 1}`,
      src: pageImage.url,
      bounds: new Box(0, top, width, height),
      assetId,
      shapeId: createShapeId(),
    });
    
    top += height + pageSpacing;
    widest = Math.max(widest, width);
  }

  // Center all pages horizontally
  for (const page of pages) {
    page.bounds.x = (widest - page.bounds.width) / 2;
  }

  return {
    name: 'document.pdf',
    pages,
    source: new ArrayBuffer(0),
  };
}

export default function PdfEditorWrapper() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    // Listen for messages from parent window
    const handleMessage = async (event: MessageEvent) => {
      console.log('Received message:', event.data);  // Debug log
      const { type, page_images, path, state_url } = event.data;
      
      if (type === 'pdf' && Array.isArray(page_images)) {
        try {
          console.log('Initializing from page images...');
          const pdf = await initializeFromPageImages(page_images);
          console.log('PDF initialized with', pdf.pages.length, 'pages');

          // If we have state_url (base64 data), update the URLs in it
          const updatedStateUrl = state_url ? updateStateUrls(state_url, page_images) : undefined;

          setState(prev => ({
            phase: 'edit',
            config: { 
              type, 
              path: path || (prev.phase === 'edit' ? prev.config.path : undefined)
            },
            pdf,
            state_url: updatedStateUrl
          }));
        } catch (error) {
          console.error('Failed to load page images:', error);
        }
      } else if (type === 'UPDATE_URLS' && Array.isArray(page_images) && state.phase === 'edit') {
        // Handle URL updates
        try {
          const pdf = await initializeFromPageImages(page_images);
          setState(prev => {
            if (prev.phase !== 'edit') return prev;
            return {
              ...prev,
              pdf,
              state_url: undefined // clear state_url to force reloading with updated signed URLs
            };
          });
        } catch (error) {
          console.error('Failed to update page URLs:', error);
        }
      } else if (type === 'whiteboard') {
        setState({
          phase: 'edit',
          config: { type, path },
          state_url
        });
      }
    };

    window.addEventListener('message', handleMessage);
    
    // Notify parent that we're ready to receive configuration
    window.parent.postMessage({ type: 'EDITOR_READY' }, '*');

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [state.phase]); // We only need state.phase since we use setState callback for updates

  if (state.phase === 'loading') {
    return <div className="PdfEditor">Loading...</div>;
  }

  return (
    <div className="PdfEditor">
      <PdfEditor 
        type={state.config.type} 
        pdf={state.pdf} 
        path={state.config.path}
        state_url={state.state_url}
      />
    </div>
  );
}