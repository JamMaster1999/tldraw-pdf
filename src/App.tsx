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
      signed_url?: string;
    };

const pageSpacing = 32;

async function initializePdf(name: string, source: ArrayBuffer): Promise<Pdf> {
  const PdfJS = await import('pdfjs-dist');
  PdfJS.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
  
  const pdf = await PdfJS.getDocument(source.slice(0)).promise;
  const pages: PdfPage[] = [];

  const canvas = window.document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Failed to create canvas context');

  const visualScale = 1.5;
  const scale = window.devicePixelRatio;

  let top = 0;
  let widest = 0;
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: scale * visualScale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const renderContext = {
      canvasContext: context,
      viewport,
    };
    await page.render(renderContext).promise;

    const width = viewport.width / scale;
    const height = viewport.height / scale;
    pages.push({
      src: canvas.toDataURL(),
      bounds: new Box(0, top, width, height),
      assetId: AssetRecordType.createId(),
      shapeId: createShapeId(),
    });
    top += height + pageSpacing;
    widest = Math.max(widest, width);
  }
  
  canvas.width = 0;
  canvas.height = 0;

  for (const page of pages) {
    page.bounds.x = (widest - page.bounds.width) / 2;
  }

  return {
    name,
    pages,
    source,
  };
}

export default function PdfEditorWrapper() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    // Listen for messages from parent window
    const handleMessage = async (event: MessageEvent) => {
      console.log('Received message:', event.data);  // Debug log
      const { type, pdf_url, path, signed_url } = event.data;
      
      if (type === 'pdf' && pdf_url) {
        try {
          let pdfArrayBuffer;
          
          // Check if pdf_url is a base64 string
          if (pdf_url.startsWith('data:application/pdf;base64,')) {
            // Convert base64 to ArrayBuffer
            const base64 = pdf_url.split(',')[1];
            const binaryString = window.atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            pdfArrayBuffer = bytes.buffer;
          } else {
            // Handle URL case (fallback)
            const response = await fetch(pdf_url);
            pdfArrayBuffer = await response.arrayBuffer();
          }

          // Initialize PDF with pages
          console.log('Initializing PDF...');
          const pdf = await initializePdf('document.pdf', pdfArrayBuffer);
          console.log('PDF initialized with', pdf.pages.length, 'pages');

          console.log('Setting state with:', { type, path, signed_url });
          setState({
            phase: 'edit',
            config: { type, pdfUrl: pdf_url, path },
            pdf,
            signed_url
          });
        } catch (error) {
          console.error('Failed to load PDF:', error);
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
  }, []);

  if (state.phase === 'loading') {
    return <div className="PdfEditor">Loading...</div>;
  }

  return (
    <div className="PdfEditor">
      <PdfEditor 
        type={state.config.type} 
        pdf={state.pdf} 
        path={state.config.path}
        signed_url={state.signed_url}  // Pass the signed_url to PdfEditor
      />
    </div>
  );
}