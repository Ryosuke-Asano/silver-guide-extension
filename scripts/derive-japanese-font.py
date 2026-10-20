"""Derive a deterministic, static Japanese TrueType font for safe PDF subsetting."""
import sys
import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

if fontTools.version != "4.63.0":
    raise RuntimeError("This derivation requires pinned fontTools 4.63.0")
if len(sys.argv) != 3:
    raise RuntimeError("Usage: derive-japanese-font.py source.ttf output.ttf")
font = TTFont(sys.argv[1], recalcTimestamp=False)
instantiateVariableFont(font, {"wght": 400}, inplace=True, optimize=True, updateFontNames=True)
# Fontkit's loca writer needs four-byte glyph alignment; odd glyph lengths lose contours.
font["glyf"].padding = 4
font.save(sys.argv[2], reorderTables=True)
