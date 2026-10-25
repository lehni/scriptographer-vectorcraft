//! The codecs of `CompressionStream` and `DecompressionStream` outside a browser
//! (`js/src/compression.js`): gzip, deflate (zlib) and deflate-raw over flate2, brotli over the
//! brotli crate. A stream's chunks go through its codec as they come, on the script's thread.

use std::io::Write;

use flate2::write::{DeflateEncoder, GzDecoder, GzEncoder, ZlibEncoder};
use flate2::{Compression, Decompress, FlushDecompress, Status};

use brotli::{BrotliResult, BrotliState, HeapAlloc, HuffmanCode};

use crate::{Call, Engine, Error, HostFunction, Value};

/// The most a chunk may decompress to, in bytes: more fails the stream.
const MOST: usize = 512 * 1024 * 1024;
/// How much a decoder makes at a time.
const PART: usize = 64 * 1024;

/// brotli's decoder, which makes what it decodes into the room it's given.
type BrotliDecoder = BrotliState<HeapAlloc<u8>, HeapAlloc<u32>, HeapAlloc<HuffmanCode>>;

/// A stream's codec, writing what it makes into its `Vec`.
enum Codec {
    Gzip(GzEncoder<Vec<u8>>),
    Deflate(ZlibEncoder<Vec<u8>>),
    DeflateRaw(DeflateEncoder<Vec<u8>>),
    Brotli(Box<brotli::CompressorWriter<Vec<u8>>>),
    Gunzip(GzDecoder<Vec<u8>>),
    /// deflate and deflate-raw, and whether their data ended.
    Inflate(Box<Decompress>, bool),
    /// brotli, and whether its data ended.
    Unbrotli(Box<BrotliDecoder>, bool),
}

/// A stream's codec, by the stream's number.
pub(crate) struct Coder {
    number: u32,
    codec: Codec,
}

/// The natives `js/src/compression.js` talks through: `open(format, decompress)`, which gives the
/// stream's number, `write(number, bytes)` and `finish(number)`, which give what the codec made of
/// them, and `close(number)`.
pub(crate) fn natives<E: Engine>(engine: &mut E) -> Result<Vec<(&'static str, E::Handle)>, Error> {
    let natives: [(&str, HostFunction<E::Handle>); 4] = [("open", open), ("write", write), ("finish", finish), ("close", close)];
    natives.into_iter().map(|(name, f)| Ok((name, engine.function(name, f)?))).collect()
}

fn open<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let format = call.to_string(args.first().unwrap_or(&Value::Undefined))?;
    let decompress = matches!(args.get(1), Some(Value::Bool(true)));
    let codec = Codec::open(&format, decompress).ok_or_else(|| Error::Type(format!("Unsupported compression format: '{format}'.")))?;
    let host = call.host()?;
    let mut host = host.borrow_mut();
    host.next_coder = host.next_coder.wrapping_add(1);
    let number = host.next_coder;
    host.coders.push(Coder { number, codec });
    Ok(Value::Number(f64::from(number)))
}

/// The number in `args[0]`.
fn number<H>(call: &mut dyn Call<H>, args: &[Value<H>]) -> Result<u32, Error> {
    Ok(call.to_number(args.first().unwrap_or(&Value::Undefined))? as u32)
}

/// `write(number, bytes)`: what the codec made of `bytes`, and why the stream fails, if it does:
/// a decoder takes no more once its data ended, but gives what it made before.
fn write<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let number = number(call, args)?;
    let Some(Value::Js(bytes)) = args.get(1) else {
        return Err(Error::Type("Invalid chunk: not a buffer.".into()));
    };
    let bytes = call.bytes(bytes)?;
    let made = {
        let host = call.host()?;
        let mut host = host.borrow_mut();
        let coder = host.coders.iter_mut().find(|c| c.number == number).ok_or_else(|| Error::Type("the stream is closed".into()))?;
        coder.codec.write(&bytes)
    };
    let (made, failure) = match made {
        Ok(made) => (made, Value::Undefined),
        Err((made, failure)) => (made, Value::String(failure.to_string())),
    };
    let made = Value::Js(call.new_uint8_array(&made)?);
    Ok(Value::Js(call.new_array(&[made, failure])?))
}

/// `finish(number)`: the rest of what the codec makes, once the stream ends, which fails for a
/// decoder whose data didn't end.
fn finish<H: Clone>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let number = number(call, args)?;
    let coder = {
        let host = call.host()?;
        let mut host = host.borrow_mut();
        let at = host.coders.iter().position(|c| c.number == number).ok_or_else(|| Error::Type("the stream is closed".into()))?;
        host.coders.swap_remove(at)
    };
    let made = coder.codec.finish()?;
    Ok(Value::Js(call.new_uint8_array(&made)?))
}

/// `close(number)`: the stream was cancelled or failed.
fn close<H>(call: &mut dyn Call<H>, _this: &Value<H>, args: &[Value<H>]) -> Result<Value<H>, Error> {
    let number = number(call, args)?;
    call.host()?.borrow_mut().coders.retain(|c| c.number != number);
    Ok(Value::Undefined)
}

impl Codec {
    /// The codec of `format`, that compresses or `decompress`es; `None` for a format it doesn't know.
    fn open(format: &str, decompress: bool) -> Option<Self> {
        let level = Compression::default();
        Some(match (format, decompress) {
            ("gzip", false) => Codec::Gzip(GzEncoder::new(Vec::new(), level)),
            ("deflate", false) => Codec::Deflate(ZlibEncoder::new(Vec::new(), level)),
            ("deflate-raw", false) => Codec::DeflateRaw(DeflateEncoder::new(Vec::new(), level)),
            ("brotli", false) => Codec::Brotli(Box::new(brotli::CompressorWriter::new(Vec::new(), PART, 6, 22))),
            ("gzip", true) => Codec::Gunzip(GzDecoder::new(Vec::new())),
            ("deflate", true) => Codec::Inflate(Box::new(Decompress::new(true)), false),
            ("deflate-raw", true) => Codec::Inflate(Box::new(Decompress::new(false)), false),
            ("brotli", true) => {
                let decoder = BrotliState::new(HeapAlloc::new(0), HeapAlloc::new(0), HeapAlloc::new(HuffmanCode::default()));
                Codec::Unbrotli(Box::new(decoder), false)
            }
            _ => return None,
        })
    }

    /// Writes `bytes` through the codec, and takes what it made of them; on a failure, with what
    /// it made before.
    fn write(&mut self, mut bytes: &[u8]) -> Result<Vec<u8>, (Vec<u8>, Error)> {
        let mut made = Vec::new();
        while !bytes.is_empty() {
            let written = match self {
                Self::Gzip(c) => c.write(bytes),
                Self::Deflate(c) => c.write(bytes),
                Self::DeflateRaw(c) => c.write(bytes),
                Self::Brotli(c) => c.write(bytes),
                // What it decodes waits in it until it's flushed:
                Self::Gunzip(c) => c.write(bytes).and_then(|count| c.flush().map(|()| count)),
                Self::Unbrotli(decoder, ended) => unbrotli_part(decoder, ended, bytes, &mut made),
                Self::Inflate(inflate, ended) => inflate_part(inflate, ended, bytes, &mut made),
            };
            match written {
                // A decoder takes nothing once its data ended:
                Ok(0) => return Err((self.take(made), invalid("data after the end"))),
                Ok(count) => bytes = bytes.get(count..).unwrap_or_default(),
                Err(e) => return Err((self.take(made), invalid(e))),
            }
            if made.len() + self.made().map_or(0, |m| m.len()) > MOST {
                return Err((Vec::new(), invalid("the data decompresses to too much")));
            }
        }
        Ok(self.take(made))
    }

    /// What the codec made and wasn't taken yet, after `made`.
    fn take(&mut self, mut made: Vec<u8>) -> Vec<u8> {
        if let Some(rest) = self.made() {
            made.append(rest);
        }
        made
    }

    /// What a codec that writes into a `Vec` made and wasn't taken yet.
    fn made(&mut self) -> Option<&mut Vec<u8>> {
        match self {
            Self::Gzip(c) => Some(c.get_mut()),
            Self::Deflate(c) => Some(c.get_mut()),
            Self::DeflateRaw(c) => Some(c.get_mut()),
            Self::Brotli(c) => Some(c.get_mut()),
            Self::Gunzip(c) => Some(c.get_mut()),
            Self::Inflate(..) | Self::Unbrotli(..) => None,
        }
    }

    /// The rest of what the codec makes, or why its data didn't end.
    fn finish(self) -> Result<Vec<u8>, Error> {
        match self {
            Self::Gzip(c) => c.finish().map_err(invalid),
            Self::Deflate(c) => c.finish().map_err(invalid),
            Self::DeflateRaw(c) => c.finish().map_err(invalid),
            Self::Brotli(c) => Ok(c.into_inner()),
            Self::Gunzip(c) => c.finish().map_err(invalid),
            Self::Inflate(_, true) | Self::Unbrotli(_, true) => Ok(Vec::new()),
            Self::Inflate(_, false) | Self::Unbrotli(_, false) => Err(invalid("the data ended early")),
        }
    }
}

/// Inflates `bytes` into `made`, until the data ends: how many it took, none once it `ended`.
fn inflate_part(inflate: &mut Decompress, ended: &mut bool, bytes: &[u8], made: &mut Vec<u8>) -> std::io::Result<usize> {
    let start = inflate.total_in();
    let taken = |inflate: &Decompress| usize::try_from(inflate.total_in() - start).unwrap_or(usize::MAX);
    while !*ended && taken(inflate) < bytes.len() {
        // Room for what it makes, as it fills only what's free:
        made.reserve(PART);
        let rest = bytes.get(taken(inflate)..).unwrap_or_default();
        *ended = inflate.decompress_vec(rest, made, FlushDecompress::None).map_err(std::io::Error::other)? == Status::StreamEnd;
        if made.len() > MOST {
            return Err(std::io::Error::other("the data decompresses to too much"));
        }
    }
    Ok(taken(inflate))
}

/// Decodes the brotli `bytes` into `made`, a part at a time, until the data ends: how many it took,
/// none once it `ended`. It stops past [`MOST`], however much more the data would make.
fn unbrotli_part(decoder: &mut BrotliDecoder, ended: &mut bool, bytes: &[u8], made: &mut Vec<u8>) -> std::io::Result<usize> {
    let (mut available_in, mut taken) = (bytes.len(), 0);
    let mut part = vec![0; PART];
    while !*ended {
        let (mut available_out, mut written, mut total) = (PART, 0, 0);
        let result =
            brotli::BrotliDecompressStream(&mut available_in, &mut taken, bytes, &mut available_out, &mut written, &mut part, &mut total, decoder);
        made.extend_from_slice(part.get(..written).unwrap_or_default());
        if made.len() > MOST {
            return Err(std::io::Error::other("the data decompresses to too much"));
        }
        match result {
            BrotliResult::ResultSuccess => *ended = true,
            BrotliResult::NeedsMoreOutput => {}
            BrotliResult::NeedsMoreInput => break,
            BrotliResult::ResultFailure => return Err(std::io::Error::other("invalid brotli data")),
        }
    }
    Ok(taken)
}

/// The `TypeError` a stream fails with on data it can't decode.
fn invalid(error: impl std::fmt::Display) -> Error {
    Error::Type(format!("Invalid compressed data: {error}."))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::{Codec, MOST, PART};

    /// A brotli bomb (data that decompresses to more than [`MOST`]) fails once it has made that
    /// much, where the whole of what it decompressed to was made first.
    #[test]
    fn a_brotli_bomb_stops_at_the_limit() {
        let mut bomb = brotli::CompressorWriter::new(Vec::new(), PART, 1, 22);
        let zeros = vec![0u8; 1 << 20];
        for _ in 0..(MOST >> 20) + 8 {
            bomb.write_all(&zeros).unwrap();
        }
        let bomb = bomb.into_inner();
        let Some(mut codec) = Codec::open("brotli", true) else { panic!("brotli decodes") };
        assert!(codec.write(&bomb).is_err(), "too much");
        assert!(codec.made().map_or(0, |m| m.len()) <= MOST + PART, "it stopped at the limit");
    }
}
