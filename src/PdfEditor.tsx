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

export function PdfEditor({ type, pdf, path }: PdfEditorProps) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Track changes
  const handleChange = useCallback((editor: any) => {
    console.log('handleChange called');
    setCountdown(10); // Start countdown from 10 seconds
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (!path || !saveRef.current) return;

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
  }, [path, countdown]);

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
  console.log('PdfEditor rendered with props:', { type, path, hasPdf: !!pdf });

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
            const file = new File([stateStr], 'state.json', { type: 'application/json' });
            
            const formData = new FormData();
            formData.append('path', path.replace('https://uflo-screenshots.s3.us-west-1.amazonaws.com/', ''));
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
            window.parent.postMessage({ type: 'SAVE_COMPLETE', path }, '*');
            
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
            disabled={isSaving || !path}
          >
            {isSaving ? 'Saving...' : 'Save Drawings'}
          </button>
        );
      },
    }),
    [pdf, path, countdown]
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

              // Only trigger handleChange if we're not already counting down
              // and if we're in whiteboard mode or have changes that aren't just initialization
              if (!changes.added) {
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
              }
            },
            { scope: 'document', source: 'user' }
          );

          // Handle async initialization
          (async () => {
            // First load initial state if available
            if (path && !isInitialized) {
              try {
                console.log('Loading initial state from:', path);
                const response = await fetch(path);
                if (!response.ok) {
                  throw new Error(`Failed to load state: ${response.status} ${response.statusText}`);
                }
                
                const state = await response.json();
                loadSnapshot(editor.store, state);
                console.log('Initial state loaded successfully');
              } catch (error) {
                console.error('Failed to load initial state:', error);
              } finally {
                setIsInitialized(true);
              }
            }

            // Then set up PDF if we have one
            if (pdf && pdf.pages.length > 0) {
              // First create any missing assets
              const existingAssets = new Set(
                Object.entries(editor.store.query.records("asset"))
                  .map(([id]) => id)
              );
              const assetsToCreate = pdf.pages.filter(page => !existingAssets.has(page.assetId));
              
              if (assetsToCreate.length > 0) {
                await editor.createAssets(
                  assetsToCreate.map((page) => ({
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
                );
              }

              // Then create any missing shapes
              const existingShapes = new Set(
                Object.entries(editor.store.query.records("shape"))
                  .map(([id]) => id)
              );
              const shapesToCreate = pdf.pages.filter(page => !existingShapes.has(page.shapeId));
              
              if (shapesToCreate.length > 0) {
                await editor.createShapes(
                  shapesToCreate.map(
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
                );
              }

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