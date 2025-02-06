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

// Simplified asset store that just returns the URL
const createAssetStore = (): TLAssetStore => ({
  async upload(asset, file) {
    throw new Error('Upload not implemented');
  },

  resolve(asset) {
    return asset.props.src || '';
  },
});

export function PdfEditor({ type, pdf, path }: PdfEditorProps) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const pathRef = useRef(path);
  const initialLoadRef = useRef(false);

  // Update pathRef when path changes
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  // Track changes
  const handleChange = useCallback((editor: any) => {
    console.log('handleChange called');
    setCountdown(10); // Start countdown from 10 seconds
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (!pathRef.current || !saveRef.current || !initialLoadRef.current) return;

    const checkAndSave = async () => {
      if (countdown === 0) {
        console.log('Countdown reached 0, saving...');
        try {
          const save = saveRef.current;
          if (save) {
            await save();
            console.log('Auto-save completed successfully');
            setCountdown(null); // Reset countdown after successful save
          }
        } catch (error) {
          console.error('Auto-save failed:', error);
          setCountdown(10); // Retry in 10 seconds if save failed
        }
      }
    };

    checkAndSave();
  }, [countdown]);

  // Countdown effect
  useEffect(() => {
    if (countdown === null) return;
    
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 0) {
          clearInterval(interval);
          return 0;
        }
        console.log('Countdown:', prev - 1);
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [countdown]);

  // Add immediate debug log when component renders
  console.log('PdfEditor rendered with props:', { type, path: pathRef.current, hasPdf: !!pdf });

  const components = useMemo<TLComponents>(
    () => ({
      PageMenu: null,
      InFrontOfTheCanvas: () => (
        <>
          {pdf && <PageOverlayScreen pdf={pdf} />}
          {countdown !== null && (
            <div style={{
              position: 'fixed',
              top: '20px',
              right: '20px',
              background: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '4px',
              zIndex: 1000,
              fontSize: '14px',
              fontWeight: 'bold'
            }}>
              {countdown === 0 ? 'Saving...' : `Saving in ${countdown}s...`}
            </div>
          )}
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

        // Store the save function in the ref for auto-save to use
        useEffect(() => {
          saveRef.current = handleSave;
          return () => {
            saveRef.current = null;
          };
        }, [handleSave]);

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
    [pdf, countdown]
  );

  return (
    <div className="editor">
      <Tldraw
        components={components}
        autoFocus
        inferDarkMode={true}
        assets={createAssetStore()}
        onMount={(editor) => {
          console.log('Editor mounted, setting up change listeners');
          
          // Single consolidated change listener for auto-save
          const unlistenAutoSave = editor.store.listen(
            (update) => {
              // Skip if not a user source or during initialization
              if (update.source !== 'user' || !initialLoadRef.current) return;
              
              // Skip if there are no changes
              if (!update.changes) return;

              // Only trigger handleChange if we're not already counting down
              setCountdown(prev => {
                if (prev === null) {
                  console.log('New change detected, starting countdown');
                  handleChange(editor);
                  return 10;
                } else {
                  console.log('Change detected but countdown already in progress');
                  return prev;
                }
              });
            },
            { scope: 'document', source: 'user' }
          );

          // Handle async initialization
          (async () => {
            // Load initial state if available
            if (pathRef.current && !isInitialized) {
              try {
                console.log('Loading initial state from:', pathRef.current);
                const response = await fetch(pathRef.current);
                if (!response.ok) {
                  throw new Error(`Failed to load state: ${response.status} ${response.statusText}`);
                }
                
                const state = await response.json();
                loadSnapshot(editor.store, state);
                console.log('Initial state loaded successfully');
                setIsInitialized(true);
              } catch (error) {
                console.error('Failed to load initial state:', error);
              }
            }

            // Just set up camera for initial view if we have a PDF
            if (pdf && pdf.pages.length > 0) {
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

            // Mark initialization as complete
            initialLoadRef.current = true;

            // Notify parent that everything is loaded
            window.parent.postMessage({ type: 'LOAD_COMPLETE' }, '*');
          })();

          // Return cleanup function
          return () => {
            unlistenAutoSave();
          };
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