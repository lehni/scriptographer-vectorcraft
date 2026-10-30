//! The overlay of the items' draw handlers (`onDraw`, `onDrawSelection`, on items or on their
//! classes), which the app shows over the document: once a script's work is done, Paper.js's
//! hosted `project.draw()` draws them into a canvas of the view's size (`js/src/overlay.js`),
//! whose pixels the app shows until the next work draws them again, moved with the view as it
//! pans and zooms meanwhile.

use std::sync::Arc;

use vello_cpu::Pixmap;

use crate::{Engine, Error, Runtime, Value, call_bundle, object};

/// The view an overlay is drawn for: its size in points, its device pixels per point, and the
/// transform from the document to it, in points (`[a, b, c, d, tx, ty]`, as Paper.js's `Matrix`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    pub width: f64,
    pub height: f64,
    pub pixel_ratio: f64,
    pub matrix: [f64; 6],
}

/// What the draw handlers drew for `view`: its pixels, premultiplied RGBA, of the view's size in
/// device pixels.
#[derive(Clone, Debug)]
pub struct Overlay {
    pub view: View,
    pixels: Arc<Pixmap>,
}

impl Overlay {
    pub fn width(&self) -> u16 {
        self.pixels.width()
    }

    pub fn height(&self) -> u16 {
        self.pixels.height()
    }

    pub fn rgba(&self) -> &[u8] {
        self.pixels.data_as_u8_slice()
    }
}

impl<E: Engine> Runtime<E> {
    /// What the draw handlers of the active document's project draw for `view`; none when nothing
    /// there draws.
    pub fn draw_overlay(&mut self, view: View) -> Result<Option<Overlay>, Error> {
        let Some(project) = self.host.borrow().binding.active().map(|b| b.project.clone()) else {
            return Ok(None);
        };
        let paper = &self.paper;
        self.engine.with_call(|call| {
            let constructor = object(call, paper, "Matrix")?;
            let matrix = call.construct(&constructor, &view.matrix.map(Value::Number))?;
            let size = [view.width, view.height, view.pixel_ratio].map(Value::Number);
            let drawn = call_bundle(call, "drawOverlay", &[&[Value::Js(project), matrix][..], &size].concat())?;
            if matches!(drawn, Value::Null | Value::Undefined) {
                return Ok(None);
            }
            let pixels = crate::bitmap::pixels(call, &drawn)?;
            Ok(Some(Overlay { view, pixels }))
        })
    }
}
