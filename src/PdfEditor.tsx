import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  Box,
  SVGContainer,
  TLComponents,
  Tldraw,
  react,
  getSnapshot,
  useEditor,
  loadSnapshot,
  TLAssetStore,
  track,
} from 'tldraw';
import { Pdf } from './PdfPicker';

interface PdfEditorProps {
  type: 'pdf' | 'whiteboard';
  pdf?: Pdf;
  path?: string;
}

// Helper function to update camera bounds
function updateCameraBounds(editor: any, targetBounds: Box, isMobile: boolean) {
  editor.setCameraOptions({
    constraints: {
      bounds: targetBounds,
      padding: { x: isMobile ? 16 : 164, y: 64 },
      origin: { x: 0.5, y: 0 },
      initialZoom: 'fit-x-100',
      baseZoom: 'default',
      behavior: 'contain',
    },
  });
  editor.setCamera(editor.getCamera(), { reset: true });
}

// Helper function to get base path from state path
function getBasePath(statePath: string) {
  return statePath.substring(0, statePath.lastIndexOf('/') + 1);
}

// Helper function to generate UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

// Create asset store with upload support
const createAssetStore = (path?: string): TLAssetStore => ({
  async upload(asset, file) {
    if (!path) {
      throw new Error('No path provided for upload');
    }

    try {
      const basePath = getBasePath(path);
      const fileExtension = file.name.split('.').pop() || '';
      const fileName = `${generateUUID()}.${fileExtension}`;
      const fullPath = `${basePath}${fileName}`;

      const formData = new FormData();
      formData.append('path', fullPath.replace('https://uflo-screenshots.s3.us-west-1.amazonaws.com/', ''));
      formData.append('file', file);
      formData.append('bucket', 'uflo-screenshots');

      console.log('Uploading asset:', { fullPath, type: file.type });
      const response = await fetch('https://xh9i-rdvs-rnon.n7c.xano.io/api:viyKJkUs/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Failed to upload asset: ${response.status} ${response.statusText}`);
      }

      // Return just the URL string
      return `https://uflo-screenshots.s3.us-west-1.amazonaws.com/${fullPath.replace('https://uflo-screenshots.s3.us-west-1.amazonaws.com/', '')}`;
    } catch (error) {
      console.error('Failed to upload asset:', error);
      throw error;
    }
  },

  resolve(asset) {
    return asset.props.src || '';
  },
});

export function PdfEditor({ type, pdf, path }: PdfEditorProps) {
  const pathRef = useRef(path);

  // Update pathRef when path changes
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const components = useMemo<TLComponents>(
    () => ({
      PageMenu: null,
      InFrontOfTheCanvas: () => (
        <>
          {pdf && <PageOverlayScreen pdf={pdf} />}
        </>
      ),
      SharePanel: () => {
        const editor = useEditor();
        const [isSaving, setIsSaving] = useState(false);
        
        const handleSave = useCallback(async () => {
          const currentPath = pathRef.current;
          if (!currentPath) {
            console.log('No path provided for save');
            return;
          }
          
          try {
            console.log('Starting save process...', { path: currentPath });
            setIsSaving(true);
            
            const currentState = getSnapshot(editor.store);
            console.log('Got editor state:', {
              hasDocument: !!currentState.document,
              hasSession: !!currentState.session,
              documentSize: currentState.document ? Object.keys(currentState.document).length : 0
            });
            
            const stateStr = JSON.stringify(currentState);
            const file = new File([stateStr], 'state.json', { type: 'application/json' });
            
            const formData = new FormData();
            formData.append('path', currentPath.replace('https://uflo-screenshots.s3.us-west-1.amazonaws.com/', ''));
            formData.append('file', file);
            formData.append('bucket', 'uflo-screenshots');
            
            console.log('Making upload request...');
            const response = await fetch('https://xh9i-rdvs-rnon.n7c.xano.io/api:viyKJkUs/upload', {
              method: 'POST',
              body: formData
            });
            
            if (!response.ok) {
              throw new Error(`Failed to save state: ${response.status} ${response.statusText}`);
            }
            
            console.log('Save successful');
            window.parent.postMessage({ type: 'SAVE_COMPLETE', path: currentPath }, '*');
            
          } catch (error: any) {
            console.error('Failed to save state:', error);
            window.parent.postMessage({ 
              type: 'SAVE_ERROR',
              error: error?.message || 'Unknown error occurred'
            }, '*');
            throw error;
          } finally {
            setIsSaving(false);
          }
        }, [editor]);

        return (
          <button
            className="SaveDrawingsButton"
            onClick={handleSave}
            disabled={isSaving || !pathRef.current}
          >
            {isSaving ? 'Saving...' : 'Save Drawings'}
          </button>
        );
      },
    }),
    [pdf]
  );

  return (
    <div className="editor">
      <Tldraw
        components={components}
        autoFocus
        inferDarkMode={true}
        assets={createAssetStore(pathRef.current)}
        onMount={(editor) => {
          console.log('Editor mounted');

          // Handle async initialization
          (async () => {
            try {
              // First set up PDF if we have one
              if (pdf && pdf.pages.length > 0) {
                console.log('Setting up PDF pages...');
                // Create assets and shapes for PDF pages
                await Promise.all([
                  editor.createAssets(
                    pdf.pages.map((page) => ({
                      id: page.assetId,
                      typeName: 'asset',
                      type: 'image',
                      meta: {},
                      props: {
                        name: 'page',
                        src: page.src,
                        w: page.bounds.w,
                        h: page.bounds.h,
                        mimeType: 'image/webp',
                        isAnimated: false,
                      },
                    }))
                  ),
                  editor.createShapes(
                    pdf.pages.map((page) => ({
                      id: page.shapeId,
                      type: 'image',
                      x: page.bounds.x,
                      y: page.bounds.y,
                      isLocked: true,
                      meta: {
                        preventBounding: true,
                      },
                      props: {
                        assetId: page.assetId,
                        w: page.bounds.w,
                        h: page.bounds.h,
                      },
                    }))
                  ),
                ]);

                // Set up camera
                const targetBounds = pdf.pages.reduce(
                  (acc, page) => acc.union(page.bounds),
                  pdf.pages[0].bounds.clone()
                );

                let isMobile = editor.getViewportScreenBounds().width < 840;
                updateCameraBounds(editor, targetBounds, isMobile);

                react('update camera', () => {
                  const isMobileNow = editor.getViewportScreenBounds().width < 840;
                  if (isMobileNow === isMobile) return;
                  isMobile = isMobileNow;
                  updateCameraBounds(editor, targetBounds, isMobile);
                });
              }

              // Then load state if available
              if (pathRef.current) {
                try {
                  console.log('Loading initial state from:', pathRef.current);
                  const response = await fetch(pathRef.current);
                  if (response.ok) {
                    const state = await response.json();
                    loadSnapshot(editor.store, state);
                    console.log('Initial state loaded successfully');
                  } else {
                    console.warn('Failed to load state, proceeding without it');
                  }
                } catch (error) {
                  console.error('Error loading state:', error);
                }
              }

              // Finally, ensure correct z-index ordering
              if (pdf?.pages) {
                // Get all shapes
                const allShapes = editor.getCurrentPageShapes();
                
                // Separate PDF shapes from drawings
                const pdfShapes = allShapes.filter(shape => 
                  pdf.pages.some(page => page.shapeId === shape.id)
                );
                const drawingShapes = allShapes.filter(shape => 
                  !pdf.pages.some(page => page.shapeId === shape.id)
                );

                // First send PDF shapes to back
                if (pdfShapes.length > 0) {
                  editor.sendToBack(pdfShapes);
                }

                // Then bring drawings to front
                if (drawingShapes.length > 0) {
                  editor.bringToFront(drawingShapes);
                }
              }

              // Notify parent that everything is loaded
              window.parent.postMessage({ type: 'LOAD_COMPLETE' }, '*');
            } catch (error) {
              console.error('Failed during initialization:', error);
              window.parent.postMessage({ 
                type: 'LOAD_ERROR',
                error: error instanceof Error ? error.message : 'Unknown error'
              }, '*');
            }
          })();
        }}
      />
    </div>
  );
}

const PageOverlayScreen = track(function PageOverlayScreen({ pdf }: { pdf: Pdf }) {
  return (
    <SVGContainer>
      {pdf.pages.map((page) => (
        <path
          key={page.shapeId.toString()}
          d={pathForPageBounds(page.bounds)}
          fill="none"
          stroke="var(--color-overlay)"
          strokeWidth={2}
        />
      ))}
    </SVGContainer>
  );
});

function pathForPageBounds(bounds: Box) {
  return [
    'M',
    bounds.x,
    bounds.y,
    'L',
    bounds.x + bounds.w,
    bounds.y,
    'L',
    bounds.x + bounds.w,
    bounds.y + bounds.h,
    'L',
    bounds.x,
    bounds.y + bounds.h,
    'Z',
  ].join(' ');
}