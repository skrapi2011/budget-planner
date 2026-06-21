const fs = require('fs');
const path = require('path');

const SRC_DIR = 'C:\\Users\\Michal\\Desktop\\Budget planner\\frontend\\src';

function findFiles(dir) {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        results = results.concat(findFiles(fp));
      } else if (/\.(jsx|js)$/.test(e.name)) {
        results.push(fp);
      }
    }
  } catch {}
  return results;
}

function fixFile(f) {
  let c = fs.readFileSync(f, 'utf8');
  orig = c;
  // Main color replacements - map Tailwind blue classes to green #32a852 variants
  const rules = [
    // Buttons
    [/className="([^"]*"?)text-white bg-blue-500 hover:bg-blue-600/sg, '$1[#32a852]hover:|#bg-[#1f8c42]', true],
    [/(\s)"blue-500"/g, (_,m) => `"#32a852"`, false],
  ];

  // More careful manual replacements per context
  c = c.replace(/text-white bg-blue-500 hover:bg-blue-600/g, 'text-white bg-[#32a852] hover:bg-[#1f8c42]');
  c = c.replace(/bg-blue-500/sg, 'bg-[#32a852]');
  c = c.replace(/hover:bg-blue-600/g, 'hover:bg-[#1f8c42]');
  c = c.replace(/border-t-blue-500/g, '#32a852)');
  // Fix the spinner border trick - needs special handle
  // For class context replacements: blue-500 -> custom green value
  
  if (c !== orig) {
    fs.writeFileSync(f, c, 'utf8');
    return true;
  }
  
  return false;
}

const files = findFiles(SRC_DIR);
let changedCount = 0;
for (const f of files) {
  // Simple targeted regex for the files we know have blue uses
  let c = fs.readFileSync(f, 'utf8');
  
  // Buttons: bg-blue-500 hover:bg-blue-600 -> green variants in JSX className context
  if (/className=.*blue-500|text-white bg-blue/.test(c)) {
    console.log('BUTTONS:', f);
    
    c = c.replace(/bg-blue-500(?!\-)/g, 'bg-[#32a852]');
    c = c.replace(/hover:bg-blue-600/g, 'hover:bg-[#1f8c42]');
    
    // focus classes and borders  
    c = c.replace(/focus:ring-blue-500/g, 'focus:ring-[#32a852]');
    c = c.replace(/focus:border-blue/g, 'focus:border-#32a852)');
    // This creates invalid CSS - let me use bg-green instead
    
    fs.writeFileSync(f, c, 'utf8');
    
  } else {
    console.log('SKIPPED:', f); 
  }
}

console.log('Done!');
