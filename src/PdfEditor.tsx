import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  Box,
  SVGContainer,
  TLComponents,
  TLImageShape,
  TLShapePartial,
  Tldraw,
  getIndicesBetween,
  react,
  sortByIndex,
  track,
  getSnapshot,
  useEditor,
  loadSnapshot,
  TLAssetStore,
} from 'tldraw';
import { Pdf } from './PdfPicker';

interface PdfEditorProps {
  type: 'pdf' | 'whiteboard';
  pdf?: Pdf;
  path?: string;
  state_url?: string;
}

// Helper function to ensure shapes are below other shapes
function makeSureShapesAreAtBottom(editor: any, shapeIds: string[], shapeIdSet: Set<string>) {
  // Get all valid shapes
  const shapes = shapeIds
    .map((id: string) => editor.getShape(id))
    .filter((shape: any): shape is any => shape !== null && shape !== undefined)
    .sort(sortByIndex);

  if (shapes.length === 0) return;

  const pageId = editor.getCurrentPageId();
  const siblings = editor.getSortedChildIdsForParent(pageId);
  
  if (!siblings || siblings.length === 0) return;

  const currentBottomShapes = siblings
    .slice(0, shapes.length)
    .map((id: string) => editor.getShape(id))
    .filter((shape: any): shape is any => shape !== null && shape !== undefined);

  if (currentBottomShapes.length === 0) return;

  if (currentBottomShapes.every((shape: any, i: number) => shape.id === shapes[i].id)) return;

  const otherSiblings = siblings.filter((id: string) => !shapeIdSet.has(id));
  if (otherSiblings.length === 0) return;

  const bottomSibling = editor.getShape(otherSiblings[0]);
  if (!bottomSibling) return;

  const indexes = getIndicesBetween(undefined, bottomSibling.index, shapes.length);
  editor.updateShapes(
    shapes.map((shape, i) => ({
      id: shape.id,
      type: shape.type,
      isLocked: shape.isLocked,
      index: indexes[i],
    }))
  );
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

export function PdfEditor({ type, pdf, path, state_url }: PdfEditorProps) {
  const [lastChangeTime, setLastChangeTime] = useState<number>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const lastSaveTimeRef = useRef<number>(0);
  const saveRef = useRef<(() => Promise<void>) | null>(null);

  // Track changes
  const handleChange = useCallback((editor: any) => {
    if (editor.currentPageId === 'page:page') {
      setLastChangeTime(Date.now());
      setCountdown(10); // Start countdown from 10 seconds
      console.log('Drawing changed, will trigger save in 10 seconds');
    }
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (!path || !saveRef.current) return;

    const checkAndSave = async () => {
      const now = Date.now();
      if (lastChangeTime > lastSaveTimeRef.current && now - lastSaveTimeRef.current >= 10000) {
        console.log('Auto-saving drawings...');
        lastSaveTimeRef.current = now;
        try {
          const save = saveRef.current;
          if (save) {
            await save();
            console.log('Auto-save completed successfully');
            setCountdown(null); // Reset countdown after successful save
          }
        } catch (error) {
          console.error('Auto-save failed:', error);
        }
      }
    };

    const interval = setInterval(checkAndSave, 1000); // Check every second
    return () => clearInterval(interval);
  }, [path, lastChangeTime]);

  // Countdown effect
  useEffect(() => {
    if (countdown === null) return;
    
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 0) {
          clearInterval(interval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [countdown]);

  // Add immediate debug log when component renders
  console.log('PdfEditor rendered with props:', { type, path, state_url, hasPdf: !!pdf });

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
              zIndex: 1000
            }}>
              Saving in {countdown}s...
            </div>
          )}
        </>
      ),
      SharePanel: () => {
        const editor = useEditor();
        const [isSaving, setIsSaving] = useState(false);
        
        const handleSave = useCallback(async () => {
          if (!path) {
            console.log('No path provided for save');
            return;
          }
          
          try {
            console.log('Starting save process...', { path });
            setIsSaving(true);
            
            const currentState = getSnapshot(editor.store);
            console.log('Got editor state:', {
              hasDocument: !!currentState.document,
              hasSession: !!currentState.session,
              documentSize: currentState.document ? Object.keys(currentState.document).length : 0
            });
            
            const stateStr = JSON.stringify(currentState);
            const fileName = path.split('/').pop() || 'state.json';
            const file = new File([stateStr], fileName, { type: 'application/json' });
            
            const formData = new FormData();
            formData.append('path', path);
            formData.append('bucket', 'xano-test');
            formData.append('file', file);
            
            console.log('Making upload request to Xano...');
            const response = await fetch('https://xh9i-rdvs-rnon.n7c.xano.io/api:viyKJkUs/upload', {
              method: 'POST',
              body: formData,
              headers: {
                'Accept': 'application/json',
              }
            });
            
            if (!response.ok) {
              throw new Error(`Failed to upload drawings: ${response.status} ${response.statusText}`);
            }
            
            console.log('Save successful, notifying parent');
            window.parent.postMessage({ type: 'SAVE_COMPLETE', path }, '*');
            
          } catch (error: any) {
            console.error('Failed to save drawings:', error);
            window.parent.postMessage({ 
              type: 'SAVE_ERROR',
              error: error?.message || 'Unknown error occurred'
            }, '*');
            throw error;
          } finally {
            setIsSaving(false);
          }
        }, [editor, path]);

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
            disabled={isSaving || !path}
          >
            {isSaving ? 'Saving...' : 'Save Drawings'}
          </button>
        );
      },
    }),
    [pdf, path, countdown]
  );

  const loadPreviousDrawings = useCallback(async (editor: any) => {
    console.log('loadPreviousDrawings called with state_url:', typeof state_url);
    
    if (!state_url) {
      console.log('No drawings data provided');
      return;
    }

    try {
      let drawingsData;
      
      if (state_url.startsWith('data:')) {
        // Handle base64 data directly
        console.log('Processing base64 drawings data');
        const base64Data = state_url.split(',')[1];
        const jsonStr = atob(base64Data);
        drawingsData = JSON.parse(jsonStr);
      } else {
        // Fallback to URL fetch
        console.log('Fetching drawings from URL:', state_url);
        const response = await fetch(state_url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch drawings: ${response.status}`);
        }
        
        drawingsData = await response.json();
      }

      console.log('Successfully parsed drawings data:', {
        hasDocument: !!drawingsData.document,
        hasSession: !!drawingsData.session,
        documentSize: drawingsData.document ? Object.keys(drawingsData.document).length : 0
      });
      
      // Load the snapshot into the editor
      editor.setCurrentTool('select');
      loadSnapshot(editor.store, {
        document: drawingsData.document,
        session: drawingsData.session
      });
      
      console.log('Previous drawings loaded successfully');
    } catch (error) {
      console.error('Error loading previous drawings:', error);
    }
  }, [state_url]);

  return (
    <div className="editor">
      <Tldraw
        components={components}
        autoFocus
        inferDarkMode={true}
        assets={createAssetStore()}
        onMount={(editor) => {
          console.log('Editor mounted, setting up change listeners');
          
          // Add change listener for auto-save
          const unlistenAutoSave = editor.store.listen(
            (update) => {
              // Skip if not a user source or during initialization
              if (update.source !== 'user') return;
              
              // Skip if there are no changes
              if (!update.changes) return;

              const changes = update.changes;
              
              // Skip if changes only contain assets or if they're part of initialization
              if (changes.added) {
                const addedKeys = Object.keys(changes.added as Record<string, unknown>);
                // Skip if all changes are asset-related or if they're shapes being created during PDF initialization
                if (addedKeys.every((key: string) => 
                  key.startsWith('asset:') || 
                  (key.startsWith('shape:') && pdf?.pages.some(page => page.shapeId === key))
                )) {
                  return;
                }
              }

              console.log('Detected user change:', update);
              handleChange(editor);
            },
            { scope: 'document', source: 'user' }
          );

          // Set up autosave only for whiteboard mode
          if (type === 'whiteboard') {
            editor.store.listen((update) => {
              // Skip if not a user source or during initialization
              if (update.source !== 'user' || !update.changes?.added) return;
              
              const addedKeys = Object.keys(update.changes.added as Record<string, unknown>);
              // Skip if changes are only assets or initialization shapes
              if (addedKeys.every((key: string) => 
                key.startsWith('asset:') || 
                (key.startsWith('shape:') && pdf?.pages.some(page => page.shapeId === key))
              )) {
                return;
              }

              handleChange(editor);
            });
          }

          // Handle async initialization
          (async () => {
            // If we have a PDF, set it up
            if (pdf && pdf.pages.length > 0) {
              await Promise.all([
                // Create assets
                editor.createAssets(
                  pdf.pages.map((page) => ({
                    id: page.assetId,
                    typeName: 'asset',
                    type: 'image',
                    meta: {},
                    props: {
                      w: page.bounds.w,
                      h: page.bounds.h,
                      mimeType: 'image/webp',
                      src: page.src,
                      name: 'page',
                      isAnimated: false,
                    },
                  }))
                ),
                // Create shapes
                editor.createShapes(
                  pdf.pages.map(
                    (page): TLShapePartial<TLImageShape> => ({
                      id: page.shapeId,
                      type: 'image',
                      x: page.bounds.x,
                      y: page.bounds.y,
                      isLocked: true,
                      props: {
                        assetId: page.assetId,
                        w: page.bounds.w,
                        h: page.bounds.h,
                      },
                    })
                  )
                )
              ]);

              const shapeIds = pdf.pages.map((page) => page.shapeId);
              const shapeIdSet = new Set(shapeIds);

              // Set up PDF-specific handlers
              editor.sideEffects.registerBeforeChangeHandler('shape', (prev, next) => {
                if (!shapeIdSet.has(next.id)) return next;
                if (next.isLocked) return next;
                return { ...prev, isLocked: true };
              });

              makeSureShapesAreAtBottom(editor, shapeIds, shapeIdSet);
              editor.sideEffects.registerAfterCreateHandler('shape', () => 
                makeSureShapesAreAtBottom(editor, shapeIds, shapeIdSet)
              );
              editor.sideEffects.registerAfterChangeHandler('shape', () => 
                makeSureShapesAreAtBottom(editor, shapeIds, shapeIdSet)
              );

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

              // Try to load previous drawings after PDF is set up
              await loadPreviousDrawings(editor);
            }

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