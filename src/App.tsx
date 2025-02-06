import { useState, useEffect } from 'react';
import 'tldraw/tldraw.css';
import { PdfEditor } from './PdfEditor';
import { Pdf, PdfPage } from './PdfPicker';
import { Box, createShapeId, AssetRecordType } from 'tldraw';
import './pdf-editor.css';

type EditorType = 'pdf' | 'whiteboard';

type EditorConfig = {
  type: EditorType;
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
    };

const pageSpacing = 32;

// Initialize from page images
async function initializeFromPageImages(pageImages: string[]): Promise<Pdf> {
  // Create a temporary image to get dimensions
  const img = new Image();
  const loadImage = (url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  };

  const pages: PdfPage[] = [];
  let top = 0;
  let widest = 0;

  // Process each page image
  for (let i = 0; i < pageImages.length; i++) {
    await loadImage(pageImages[i]);
    const width = img.width;
    const height = img.height;
    
    pages.push({
      pageId: (i + 1).toString(),
      src: pageImages[i],
      bounds: new Box(0, top, width, height),
      assetId: AssetRecordType.createId(),
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
    imageUrls: pageImages,
    source: new ArrayBuffer(0),
  };
}

export default function PdfEditorWrapper() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const currentPath = state.phase === 'edit' ? state.config.path : undefined;

  useEffect(() => {
    // Listen for messages from parent window
    const handleMessage = async (event: MessageEvent) => {
      console.log('Received message:', event.data);  // Debug log
      const { type, page_images, path } = event.data;
      
      if (type === 'pdf' && Array.isArray(page_images)) {
        try {
          console.log('Initializing from page images...');
          const pdf = await initializeFromPageImages(page_images);
          console.log('PDF initialized with', page_images.length, 'pages');

          setState({
            phase: 'edit',
            config: { 
              type, 
              path: path || currentPath
            },
            pdf
          });
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
              pdf
            };
          });
        } catch (error) {
          console.error('Failed to update page URLs:', error);
        }
      } else if (type === 'whiteboard') {
        setState({
          phase: 'edit',
          config: { type, path }
        });
      }
    };

    window.addEventListener('message', handleMessage);
    
    // Notify parent that we're ready to receive configuration
    window.parent.postMessage({ type: 'EDITOR_READY' }, '*');

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [state.phase, currentPath]);

  if (state.phase === 'loading') {
    return <div className="PdfEditor">Loading...</div>;
  }

  return (
    <div className="PdfEditor">
      <PdfEditor 
        type={state.config.type} 
        pdf={state.pdf} 
        path={state.config.path}
      />
    </div>
  );
}