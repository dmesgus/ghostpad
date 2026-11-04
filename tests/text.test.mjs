import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textEdit, normalizeText } from '../web/text.js';
test('native insert, delete, and replacement keep the remote tail consistent',()=>{
 assert.deepEqual(textEdit('', 'hello'),{backspaces:0,text:'hello'});
 assert.deepEqual(textEdit('hello','hell'),{backspaces:1,text:''});
 assert.deepEqual(textEdit('teh world','the world'),{backspaces:8,text:'he world'});
 assert.deepEqual(textEdit('abc','abc'),{backspaces:0,text:''});
});
test('smart punctuation is normalized before conversion',()=>{assert.equal(normalizeText('“Hello”… it’s fine—yes'), '"Hello"... it\'s fine-yes');});
test('unsupported characters and oversized text are rejected as a whole',()=>{assert.throws(()=>textEdit('','hello🙂'));assert.throws(()=>textEdit('','a'.repeat(513)));assert.throws(()=>textEdit('','\x1b'));});
