// Test driver for native_pinch.py; uses the production device and event writer.
#![allow(dead_code)]
#[path = "../../src/input.rs"]
mod input;
#[path = "../../src/keys.rs"]
mod keys;
#[path = "../../src/touchpad.rs"]
mod touchpad;
use std::io::{self, BufRead, Write};
fn main() -> io::Result<()> {
    let mut pad = touchpad::Touchpad::new(false)?;
    println!("ready");
    io::stdout().flush()?;
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line == "end" {
            pad.release()?;
        } else if line == "quit" {
            break;
        } else {
            pad.update(line.parse().expect("numeric scale"))?;
        }
        println!("ok");
        io::stdout().flush()?;
    }
    Ok(())
}
