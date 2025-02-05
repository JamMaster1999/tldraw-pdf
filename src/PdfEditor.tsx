import { useMemo, useCallback, useState, useEffect } from 'react';
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
} from 'tldraw';
import { Pdf } from './PdfPicker';

interface PdfEditorProps {
  type: 'pdf' | 'whiteboard';
  pdf?: Pdf;
  path?: string;
  signed_url?: string;
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

const SaveDrawingsButton = track(function SaveDrawingsButton({ path }: { path?: string }) {
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
      
      // Get the current state
      const currentState = getSnapshot(editor.store);
      console.log('Got editor state:', {
        hasDocument: !!currentState.document,
        hasSession: !!currentState.session,
        documentSize: currentState.document ? Object.keys(currentState.document).length : 0
      });
      
      const stateStr = JSON.stringify(currentState);
      console.log('Got editor state, size:', stateStr.length);
      
      // Create a file from the state
      const fileName = path.split('/').pop() || 'state.json';
      console.log('Creating file with name:', fileName);
      const file = new File(
        [stateStr], 
        fileName,
        { type: 'application/json' }
      );

      // Create form data
      const formData = new FormData();
      formData.append('path', path);
      formData.append('bucket', 'xano-test');
      formData.append('file', file);
      
      console.log('Making upload request to Xano...');
      // Make the upload request
      const response = await fetch('https://xh9i-rdvs-rnon.n7c.xano.io/api:viyKJkUs/upload', {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
        }
      });

      console.log('Got response:', response.status);
      const responseData = await response.json();
      console.log('Response data:', responseData);

      if (!response.ok) {
        throw new Error(`Failed to upload drawings: ${response.status} ${response.statusText}`);
      }

      console.log('Save successful, notifying parent');
      // Notify parent of successful save
      window.parent.postMessage({ 
        type: 'SAVE_COMPLETE',
        path 
      }, '*');

    } catch (error: any) {
      console.error('Failed to save drawings:', error);
      // Notify parent of save error
      window.parent.postMessage({ 
        type: 'SAVE_ERROR',
        error: error?.message || 'Unknown error occurred'
      }, '*');
    } finally {
      setIsSaving(false);
    }
  }, [editor, path]);

  // Log when the button is rendered
  console.log('Rendering SaveDrawingsButton with path:', path);

  return (
    <button
      className="SaveDrawingsButton"
      onClick={handleSave}
      disabled={isSaving || !path}
    >
      {isSaving ? 'Saving...' : 'Save Drawings'}
    </button>
  );
});

export function PdfEditor({ type, pdf, path, signed_url }: PdfEditorProps) {
  // Add immediate debug log when component renders
  console.log('PdfEditor rendered with props:', { type, path, signed_url, hasPdf: !!pdf });

  // Add effect to log when props change
  useEffect(() => {
    console.log('PdfEditor props changed:', { type, path, signed_url, hasPdf: !!pdf });
  }, [type, path, signed_url, pdf]);

  const components = useMemo<TLComponents>(
    () => ({
      PageMenu: null,
      InFrontOfTheCanvas: () => pdf ? <PageOverlayScreen pdf={pdf} /> : null,
      SharePanel: () => <SaveDrawingsButton path={path} />,
    }),
    [pdf, path]
  );

  const handleSave = useCallback((editor: any) => {
    const currentState = getSnapshot(editor.store);
    if (type === 'whiteboard') {
      window.parent.postMessage({ 
        type: 'SAVE_STATE', 
        format: 'base64',
        state: btoa(JSON.stringify(currentState))
      }, '*');
    }
  }, [type]);

  const loadPreviousDrawings = useCallback(async (editor: any) => {
    console.log('loadPreviousDrawings called with signed_url:', typeof signed_url);
    
    if (!signed_url) {
      console.log('No drawings data provided');
      return;
    }

    try {
      let drawingsData;
      
      if (signed_url.startsWith('data:')) {
        // Handle base64 data directly
        console.log('Processing base64 drawings data');
        const base64Data = signed_url.split(',')[1];
        const jsonStr = atob(base64Data);
        drawingsData = JSON.parse(jsonStr);
      } else {
        // Fallback to URL fetch
        console.log('Fetching drawings from URL:', signed_url);
        const response = await fetch(signed_url, {
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
  }, [signed_url]);

  return (
    <div className="editor">
      <Tldraw
        components={components}
        autoFocus
        inferDarkMode={true}
        onMount={(editor) => {
          // Set up autosave only for whiteboard mode
          if (type === 'whiteboard') {
            editor.store.listen(() => {
              handleSave(editor);
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
                      mimeType: 'image/png',
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

          // Return cleanup function if needed
          return () => {
            // Any cleanup code here
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