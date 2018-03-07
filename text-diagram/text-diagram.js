/*
 * text-diagram.js
 *
 * Copyright 2011, Todd Wei
 * Dual licensed under the MIT or GPL Version 2 licenses.
 *
 * Author: weidagang@gmail.com
 */

/*
 * Sequence diagram grammar:
 *
 * <program> ::= <empty> | <statements>
 * <statements> ::= <statement> <statements>
 * <statement> ::= <object-declaration> | <message-statement> | <note-statement> | <space-statement>
 * <object-declaration> ::= "object" <object> <EOS>
 * <message-statement> ::= <object> "->" <object> <content> <EOS>
 * <note-statement> ::= <side> "of" <object> <note> <EOS>
 * <space-statement> ::= <size>
 * <object> ::= ([a-z]|[A-Z]|[0-9]|_)+
 * <content> ::= <empty> | ":" <text>
 * <note> ::= ":" <text>
 * <size> ::= <integer>
 * <EOS> ::= ';' | '\n' | EOF
 */

var nl = ie ? '\r' : '\n';

/**
 * The main function to draw UML sequence diagram. 3 major steps:
 * 1) parse the source code into AST;
 * 2) convert the AST to ASCII image objects;
 * 3) convert image objects to HTML;
 */
function sequence_diagram(in_src) {
  var ast = parser.sequence_diagram(in_src);
  //console.log('ast:', ast);

  if (null == ast) {
    return null;
  }

  var cimage = html_render.to_cimage(ast);
  var dom_ele = html_render.to_html(cimage);
  return dom_ele;
};

//render diagram as html
var html_render = (function() {
  //cpoint
  function _cpoint(in_c, in_x, in_y, in_z) {
    return { c : in_c, x : in_x, y : in_y, z : in_z };
  }

  //create a ccanvas
  function _ccanvas(in_x, in_y) {
    var m = new Array(in_y);
    for (i = 0; i < in_y; ++i) {
      m[i] = new Array(in_x);
    }
    return m;
  }

  //convert ccanvas to DOM element
  function _to_html(in_m) {
    var pre = document.createElement('pre');
    pre.id = 'diagram';

    for (y = 0; y < in_m.length; ++y) {
      for (x = 0; x < in_m[y].length; ++x) {
        var c = in_m[y][x] ? in_m[y][x].c : ' ';
        pre.appendChild(document.createTextNode(c));
      }
      pre.appendChild(document.createTextNode(nl));
    }

    return pre;
  }

  function _add_meta(in_ast) {
    in_ast.meta = {};

    var meta = in_ast.meta;
    meta.objs = [];
    meta.obj_idxes = {};
    meta.boxes = {};
    meta.lines = {};
    meta.x_spans = {};
    meta.notes = {};
    meta.messages = {};
    meta.statements = [];

    function _traverse(ast) {
      ast.meta = ast.meta || {};

            // set index for each object (participant)
      function _add_obj(obj) {
        if (null == meta.obj_idxes[obj]) {
          var idx = meta.objs.length;
          meta.obj_idxes[obj] = idx;
          meta.objs.push(obj);
          meta.boxes[obj] = {};
          meta.lines[obj] = {};
          meta.x_spans[obj] = {};
          meta.notes[obj] = [];
          meta.messages[obj] = [];
        }
      }

      if ('object_declaration' == ast.type) {
        for (var i in ast.attr.names) {
          _add_obj(ast.attr.names[i]);
        }
      }
      else if ('message_statement' == ast.type) {
        meta.statements.push(ast);

        var s = ast.attr.sender;
        var r = ast.attr.receiver;

        //object index
        _add_obj(s);
        _add_obj(r);
        ast.meta.sender_index = meta.obj_idxes[s];
        ast.meta.receiver_index = meta.obj_idxes[r];

        var left_obj = meta.objs[Math.min(ast.meta.sender_index, ast.meta.receiver_index)];
        var right_obj = meta.objs[Math.max(ast.meta.sender_index, ast.meta.receiver_index)];
        ast.meta.left_obj = left_obj;
        ast.meta.right_obj = right_obj;

        meta.messages[left_obj].push(ast);
      }
      else if ('note_statement' == ast.type) {
        meta.statements.push(ast);

        var obj = ast.attr.object;
        var side = ast.attr.side;
        var content = ast.attr.content;

        _add_obj(obj);

        meta.notes[obj].push(ast);
      }

      for (var i in ast.children) {
        _traverse(ast.children[i]);
      }
    }

    _traverse(in_ast);

    //calculate position for each object (participant)
    for (var i = 0; i < meta.objs.length; ++i) {
      var obj = meta.objs[i];
      var box_width = _box_width(obj);
      var half_box_width = (box_width - 1) / 2;

      meta.boxes[obj].x1 = (0 == i ? 0 : meta.boxes[meta.objs[i-1]].x2 + 1);
      meta.x_spans[obj].x2 = box_width;

      var pre_line_offset = (0 == i ? -1 : meta.lines[meta.objs[i-1]].x_offset);

      // 1) box.x1
      //// left note
      for (var j = 0; j < meta.notes[obj].length; ++j) {
        var note_ast = meta.notes[obj][j];
        var note_width = _note_width(note_ast.attr.content);
        if ('left' == note_ast.attr.side) {
          meta.boxes[obj].x1 = Math.max(meta.boxes[obj].x1, pre_line_offset + 1 + note_width + 1 - half_box_width);
        }
      }

      //// previous right note
      if (i > 0) {
        var pre_obj = meta.objs[i-1];
        for (var k = 0; k < meta.notes[pre_obj].length; ++k) {
          var note_ast = meta.notes[pre_obj][k];
          if ('right' == note_ast.attr.side) {
            meta.boxes[obj].x1 = Math.max(meta.boxes[obj].x1, meta.lines[pre_obj].x_offset + 1 + _note_width(note_ast.attr.content));
          }
        }
      }

      //// message
      for (var j = 0; j < i; j++) {
        var pre_obj = meta.objs[j];
        for (var k = 0; k < meta.messages[pre_obj].length; ++k) {
          var msg_ast = meta.messages[pre_obj][k];
          if (msg_ast.meta.right_obj == obj) {
            meta.boxes[obj].x1 = Math.max(meta.boxes[obj].x1, meta.lines[pre_obj].x_offset + 1 + _msg_width(msg_ast.attr.message));
          }
        }
      }
      //// previous self message
      if (i > 0) {
        var pre_obj = meta.objs[i-1];
        for (var j = 0; j < meta.messages[pre_obj].length; ++j) {
          var tmp_ast = meta.messages[pre_obj][j];
          if (tmp_ast.meta.sender_index == tmp_ast.meta.receiver_index) {
            var message_width = _msg_width(tmp_ast.attr.message);
            meta.boxes[obj].x1 = Math.max(meta.boxes[obj].x1, meta.lines[pre_obj].x_offset + 1 + message_width);
          }
        }
      }

      meta.boxes[obj].x2 = meta.boxes[obj].x1 + box_width;

      // 2) line.x_offset
      meta.lines[obj].x_offset = meta.boxes[obj].x1 + half_box_width;

      // 3) x_span
      meta.x_spans[obj].x1 = meta.boxes[obj].x1;
      for (var j = 0; j < meta.notes[obj].length; ++j) {
        var note = meta.notes[obj][j];
        var note_width = _note_width(note);
        if ('right' == note.side) {
          meta.x_spans[obj].x2 = Math.max(meta.x_spans[obj].x2, meta.lines[obj].x_offset + 1 + note_width);
        }
      }
      for (var j = 0; j < meta.messages[obj].length; ++j) {
        var tmp_ast = meta.messages[obj][j];
        if (tmp_ast.meta.sender_index == tmp_ast.meta.receiver_index) {
          var message_width = _msg_width(tmp_ast.attr.message);
          meta.x_spans[obj].x2 = Math.max(meta.x_spans[obj].x2, meta.lines[obj].x_offset + 1 + message_width);
        }
      }
    }

    //get canvas width
    var min_x = 0;
    var max_x = 0;
    for (var i in meta.x_spans) {
      min_x = Math.min(meta.x_spans[i].x1, min_x);
      max_x = Math.max(meta.x_spans[i].x2, max_x);
    }
    meta.min_x = min_x;
    meta.max_x = max_x;
    meta.width = max_x - min_x;

    //get canvas height
    function _get_height(ast, in_y_offset) {
      ast.meta.y1 = in_y_offset;

      if ('object_declaration' == ast.type) {
        ast.meta.y2 = in_y_offset;
      }
      else if ('message_statement' == ast.type) {
        if (ast.meta.sender_index == ast.meta.receiver_index)
        {
          ast.meta.y2 = in_y_offset + 4 + ast.attr.message.split('\\n').length;
        }
        else
        {
          ast.meta.y2 = in_y_offset + 2 + ast.attr.message.split('\\n').length;;
        }
      }
      else if ('note_statement' == ast.type) {
        ast.meta.y2 = in_y_offset + 2 + ast.attr.content.split('\\n').length;
      }
      else if ('space_statement' == ast.type) {
        ast.meta.y2 = in_y_offset + ast.attr.gap_size;
      }
      else {
        var y_offset;
        if ('sequence_diagram' == ast.type) {
          y_offset = 3;
        }
        else {
          y_offset = in_y_offset;
        }

        if (ast.children.length > 0) {
          for (var i in ast.children) {
            _get_height(ast.children[i], y_offset);
            y_offset = ast.children[i].meta.y2;
          }

          ast.meta.y2 = ast.children[ast.children.length - 1].meta.y2;
        }
        else {
          ast.meta.y2 = ast.meta.y1;
        }

        if ('sequence_diagram' == ast.type) {
          ast.meta.y2 += 1;
        }
      }

      return ast.meta.y2 - ast.meta.y1;
    }

    _get_height(in_ast, 0);
    meta.height = in_ast.meta.y2;
  }

  //convert ast to cimage
  function _to_cimage(in_ast) {
    //add meta info to tree
    _add_meta(in_ast);

    var meta = in_ast.meta;

    //init canvas
    var ccanvas = _ccanvas(meta.width, meta.height);
    //console.log(meta.width + ", " + meta.height);

    //name box
    for (var i in meta.objs) {
      var obj = meta.objs[i];
      var cbox = _cbox(obj);
      _draw_cpoints(ccanvas, meta.boxes[obj].x1 - meta.min_x, 0, cbox);
    }

    //life line
    for (var i in meta.objs) {
      var obj = meta.objs[i];
      var cline = _lifeline(meta.height - 3);
      _draw_cpoints(ccanvas, meta.lines[obj].x_offset - meta.min_x, 3, cline);
    }

    //messages and notes
    for (var i in meta.statements) {
      var ast = meta.statements[i];
      //console.log(ast);
      if ('message_statement' == ast.type) {
        var s = ast.attr.sender;
        var r = ast.attr.receiver;
        var leftObj = meta.obj_idxes[s] < meta.obj_idxes[r] ? s : r;
        var rightObj = meta.obj_idxes[s] < meta.obj_idxes[r] ? r : s;
        var line_len = meta.lines[rightObj].x_offset - meta.lines[leftObj].x_offset - 1;

        var cmessage = _cmessage(ast.attr.message, line_len, s == leftObj, s == r);

        _draw_cpoints(ccanvas, meta.lines[leftObj].x_offset + 1 - meta.min_x, ast.meta.y1, cmessage);
      }
      else if ('note_statement' == ast.type) {
        var obj = ast.attr.object;
        var side = ast.attr.side;
        var content = ast.attr.content;
        var cnote = _cnote(content, 'left' == side);
        if ('right' == side) {
          _draw_cpoints(ccanvas, meta.lines[obj].x_offset + 1 - meta.min_x, ast.meta.y1, cnote);
        }
        else if ('left' == side) {
          _draw_cpoints(ccanvas, meta.lines[obj].x_offset - 1 - _note_width(content) - meta.min_x, ast.meta.y1, cnote);
        }
      }
    }

    return ccanvas;
  }

  function _draw_cpoints(in_canvas, in_x_offset, in_y_offset, in_cpoints) {
    for (var i in in_cpoints) {
      var p = in_cpoints[i];
      //console.log("x: " + (in_x_offset + p.x) + ", y: " + (in_y_offset + p.y));
      in_canvas[in_y_offset+p.y][in_x_offset+p.x] = { c : p.c, z : p.z };
    }
  }

  function _note_width(msg) {
    var content = ('string' == typeof(msg) ? msg : msg.attr.content);
    var lines = content.split('\\n');
    var max = 0;
    for (var i = 0; i < lines.length; ++i) {
        if (lines[i].length > max) {
            max = lines[i].trim().length;
        }
    }
    return max + 4;
  }

  function _note_height(msg) {
      var content = ('string' == typeof(msg) ? msg : msg.attr.content);
      var lines = content.split('\\n');
      return lines.length + 2;
  }

  function _box_width(msg) {
    return msg.length % 2 ? msg.length + 4 : msg.length + 5;
  }

  function _msg_width(msg) {
    var lines = msg.split('\\n');
    var max = 0;
    for (var i = 0; i < lines.length; ++i) {
        if (lines[i].length > max) {
            max = lines[i].trim().length;
        }
    }
    return max + 2;
  }

  // create image for note
  function _cnote(msg, is_left) {
    var i;
    var x = _note_width(msg);
    var y = _note_height(msg);

    var out_cimage = [];

        //association line
        if (is_left) {
            out_cimage.push(_cpoint('-', x, 1, 0));
            xoffset = 0;
        }
        else {
            out_cimage.push(_cpoint('-', 0, 1, 0));
            xoffset = 1;
        }

    //up and bottom line
    for (i = 0; i <= x - 1; ++i) {
      out_cimage.push(_cpoint('-', xoffset + i, 0, 0));
      out_cimage.push(_cpoint('-', xoffset + i , y - 1, 0));
    }

    out_cimage.push(_cpoint('\\', xoffset + x - 1, 0, 0));

    //left and right line
    for (i = 0; i < y - 1; ++i) {
        out_cimage.push(_cpoint('|', xoffset + 0, i + 1, 0));
        out_cimage.push(_cpoint('|', xoffset + x - 1, i + 1, 0));
    }

    //content
    var lines = msg.split('\\n');
    for (var idx = 0; idx < lines.length; ++idx) {
        var line = lines[idx].trim();

        for (i = 1; i < x-1; ++i) {
            out_cimage.push(_cpoint(' ', xoffset + i, idx + 1, 0));
        }

        for (i = 2; i < 2 + line.length; ++i) {
            out_cimage.push(_cpoint(line.charAt(i-2), xoffset + i, idx + 1, 0));
        }
    }

    return out_cimage;
  }

  function _cmessage(message, line_len, leftToRight, isSelfMessage) {
    var cpoints = [];

    var lines = message.split('\\n');
    var t_length = 0;
    for(var idx = 0; idx < lines.length; idx++) {
      if(lines[idx].length > t_length) {
        t_length = lines[idx].trim().length;
      }
    }

    if (isSelfMessage) {
      line_len = t_length;

      //message
      for(var idx = 0; idx < lines.length; idx++) {
        for (var i = 0; i < lines[idx].length; ++i) {
          cpoints.push(_cpoint(lines[idx].charAt(i), 1 + i, 1 + idx, 0));
        }
      }

      //upper line
      for (var i = 0; i < line_len + 1; ++i) {
        cpoints.push(_cpoint('-', i, 1 + lines.length, 0));
      }

      //bar
      cpoints.push(_cpoint('|', line_len, 2 + lines.length, 0));

      //lower line
      cpoints.push(_cpoint('<', 0, 3 + lines.length, 0));
      for (var i = 1; i < line_len + 1; ++i) {
        cpoints.push(_cpoint('-', i, 3 + lines.length, 0));
      }
    }
    else if (leftToRight) {
      //message
      for(var idx = 0; idx < lines.length; idx++) {
        for (var i = 0; i < lines[idx].length; ++i) {
          cpoints.push(_cpoint(lines[idx].charAt(i), 1 + i, 1 + idx, 0));
        }
      }

      //arrow
      for (var i = 0; i < line_len - 1; ++i) {
        cpoints.push(_cpoint('-', i, 1 + lines.length, 0));
      }
      cpoints.push(_cpoint('>', line_len - 1, 1 + lines.length, 0));
    }
    else {
      //message
      for(var idx = 0; idx < lines.length; idx++) {
        for (var i = 0; i < lines[idx].length; ++i) {
          cpoints.push(_cpoint(lines[idx].charAt(lines[idx].length - 1 - i), line_len - 1 - i - 1, 1 + idx, 0));
        }
      }

      //arrow
      cpoints.push(_cpoint('<', 0, 1 + lines.length, 0));
      for (var i = 1; i < line_len; ++i) {
        cpoints.push(_cpoint('-', i, 1 + lines.length, 0));
      }
    }

    return cpoints;
  }

  /*
  +------+
  | Todd |
  +------+
  */
  function _cbox(obj) {
    var i;
    var x = obj.length % 2 ? obj.length + 4 : obj.length + 5;
    var y = 3;

    var out_cimage = [];

    //up and bottom line
    out_cimage.push(_cpoint('+', 0, 0, 0));
    out_cimage.push(_cpoint('+', x - 1, 0, 0));
    out_cimage.push(_cpoint('+', 0, 2, 0));
    out_cimage.push(_cpoint('+', x - 1, 2, 0));
    for (i = 1; i < x - 1; ++i) {
      out_cimage.push(_cpoint('-', i, 0, 0)); //m[0][i] = _cpoint('-', 0);
      out_cimage.push(_cpoint('-', i , 2, 0)); //m[2][i] = _cpoint('-', 0);
    }

    //left and right line
    out_cimage.push(_cpoint('|', 0, 1, 0));//m[1][0] = _cpoint('|', 0);
    out_cimage.push(_cpoint('|', x - 1, 1, 0));//m[1][x-1] = _cpoint('|', 0);

    //name
    for (i = 1; i < x-1; ++i) {
      out_cimage.push(_cpoint(' ', i, 1, 0)); //m[1][i] = null;
    }
    for (i = 2; i < 2 + obj.length; ++i) {
      out_cimage.push(_cpoint(obj.charAt(i-2), i, 1, 0)); //m[1][i] = _cpoint(obj[i-2], 0);
    }

    return out_cimage;
  }

  function _lifeline(in_height) {
    var cline = [];
    for (var j = 0; j < in_height; ++j) {
      cline.push(_cpoint('|', 0, j, 0));
    }
    return cline;
  }

  function _object_width(name) {
    return name.length % 2 ? name.length + 4 : name.length + 5;
  }


  return {
    to_html : _to_html,
    to_cimage : _to_cimage
  };
})();


//string utility
var util = (function() {
  var digits = '0123456789';
  var lowers = 'abcdefghijklmnopqrstuvwxyz';
  var uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var underscore = '_';

  var _is_in = function(in_list, in_c) {
    return in_list.indexOf(in_c) >= 0;
  };

  return {
    is_alpha: function(in_c) {
      return _is_in(lowers + uppers, in_c);
    },

    is_digit: function(in_c) {
      return _is_in(digits, in_c);
    },

    is_alpha_digit: function(in_c) {
      return _is_in(digits + lowers + uppers, in_c);
    },

    is_underscore: function(in_c) {
      return underscore == in_c;
    },

    is_whitespace: function(in_c) {
      return ' ' == in_c || '\t' == in_c;
    },

    trim: function(in_str) {
      return in_str.replace(/^\s+|\s+$/g, '')
    }
  };
})();

//program parser
var parser = (function() {
  //token constructor
  function _token(in_type, in_value) {
    return { type: in_type, value: in_value };
  }

  //lexical analysis
  var _lexical_analyze = function(in_buffer) {
    in_buffer += ';'; //append ;

    var r_tokens = [];
    var idx = 0;
    var buffer_length = in_buffer.length;
    var state = 0;
    var tmp_buffer = '';

    var _back = function() {
      tmp_buffer = '';
      idx--;
      state = 0;
    };

    //state machine
    while (idx < buffer_length) {
      var c = in_buffer.charAt(idx++);
      switch (state) {
        case 0: //initial state
          if (util.is_alpha_digit(c)) {
            tmp_buffer = c;
            state = 1;
          }
          else if ('/' == c) {
            state = 3;
          }
          else if ('-' == c) {
            tmp_buffer = c;
            state = 2;
          }
          else if (':' == c) {
            r_tokens.push(_token(':', c));
          }
          else if (';' == c) {
            r_tokens.push(_token(';', c));
          }
          else if ('\n' == c || '\r' == c) {
            r_tokens.push(_token('newline', c));
          }
          else if (util.is_whitespace(c)) {
            r_tokens.push(_token('space', c));
          }
          else {
            r_tokens.push(_token('word', c));
          }
          break;

        case 1: //word
          if (util.is_alpha_digit(c) || util.is_underscore(c)) {
            tmp_buffer = tmp_buffer + c;
          }
          else {
            r_tokens.push(_token('word', tmp_buffer));
            _back();
          }

          break;

        case 2: //arrow
          if ('>' == c) {
            tmp_buffer += c;
            r_tokens.push(_token('arrow', tmp_buffer));
            tmp_buffer = '';
            state = 0;
          }
          else {
            r_tokens.push(_token('word', tmp_buffer));
            _back();
          }
          break;

        case 3: //second slash in comment
          if ('/' == c) {
            state = 4;
          }
          break;

        case 4: //comment line
          if ('\n' == c || '\r' == c) {
            // r_tokens.push(_token('newline', c));
            state = 0;
          }
        break;

        default:
          return null;
      }
    }

    r_tokens.push(_token('eof'));

    return r_tokens;
  };

  //parse program to abstract syntax tree
  function sequence_diagram(src) {
    var tokens = _lexical_analyze(src);
    //console.log('tokens:', tokens);
    var ast = _sequence_diagram(tokens);
    return ast;
  }

  function _sequence_diagram(tokens) {
    var r = _statements(tokens, 0);

    if (null != r && r.length == tokens.length) {
      return { type: 'sequence_diagram', attr: {}, children : [ r ], offset : 0, length : tokens.length }
    }

    return null;
  }

  function _statements(in_tokens, in_offset) {
    var match_result = { type : 'statements', attr: {}, children : [], offset : in_offset, length : 0 };

    for (var idx = in_offset; idx < in_tokens.length; ) {
      var type = in_tokens[idx].type;
      var value = in_tokens[idx].value;

      if ('word' == type) {
        var r = null;
        if ('object' == value) {
          r = _object_declaration(in_tokens, idx);
        }
        else if ('alt' == value) {
          alert('alt statement');
        }
        else if ('opt' == value) {
          alert('opt statement');
        }
        else if ('loop' == value) {
          alert('loop statement');
        }
        else if ('note' == value) {
          r = _note_statement(in_tokens, idx);
        }
        else if ('space' == value) {
          r = _space_statement(in_tokens, idx);
        }
        else {
          r = _message_statement(in_tokens, idx);
        }

        if (null == r) {
          return null;
        }
        match_result.children.push(r);
        idx += r.length;
      }
      else {
        ++idx;
      }
    }

    match_result.length = idx - in_offset;
    return match_result;
  }

  function _is_object(in_str) {
    if (null == in_str || 0 == in_str.length) {
      return false;
    }

    for (var i in in_str) {
      var c = in_str.charAt(i);
      if (!util.is_alpha_digit(c) && !util.is_underscore(c)) {
        return false;
      }
    }

    return true;
  }

  function _is_keyword(in_word) {
    var keywords = { 'alt' : true, 'opt' : true, 'loop' : true, 'note' : true, 'space' : true };
    return true == keywords[in_word];
  }

  function _object_declaration(in_tokens, in_offset) {
    var match_result = {
      type : 'object_declaration',
           attr : { name : null, names : [] },
      offset : in_offset,
      length : 0
    };

    var state = 0;
    for (var i = in_offset; i < in_tokens.length && 2 != state; ++i) {
      var type = in_tokens[i].type;
      var value = in_tokens[i].value;

      switch(state) {
        case 0: //'object'
          if ('space' == type) {
            continue;
          }
          if ('object' != value) {
            return null;
          }
          state = 1;
          break;
        case 1: //names
          if ('space' == type) {
            continue;
          }
          else if (';' == type || 'newline' == type || 'eof' == type) {
            if (0 == match_result.attr.names.length) {
              return null;
            }
            state = 2;
            break;
          }
          else if ('word' != type || _is_keyword(value) || !_is_object(value)) {
            return null;
          }

          match_result.attr.names.push(value);
          break;
      }
    }

    if (2 != state) {
      return null;
    }

    match_result.length = i - in_offset;
    return match_result;
  }

  function _space_statement(in_tokens, in_offset) {
    var match_result = {
      type : 'space_statement',
           attr : { object : null, side : null, content: ''},
      offset : in_offset,
      length : 0
    };

    var state = 0;
    for (var i = in_offset; i < in_tokens.length && 2 != state; ++i) {
      var type = in_tokens[i].type;
      var value = in_tokens[i].value;

      switch(state) {
        case 0: //'space'
          if ('space' == type) {
            continue;
          }
          if ('space' != value) {
            return null;
          }
          state = 1;
          break;
        case 1: //number
          if ('space' == type) {
            continue;
          }
          var gap_size = parseInt(value);
          if (isNaN(gap_size)) {
            return null;
          }
          match_result.attr.gap_size = gap_size;
          state = 2;
          break;
      }
    }

    match_result.length = i - in_offset;
    return match_result;
  }

  function _note_statement(in_tokens, in_offset) {
    var match_result = {
      type : 'note_statement',
           attr : { object : null, side : null, content: ''},
      offset : in_offset,
      length : 0
    };

    var state = 0;
    for (var i = in_offset; i < in_tokens.length && 6 != state; ++i) {
      var type = in_tokens[i].type;
      var value = in_tokens[i].value;

      switch(state) {
        case 0: //'note'
          if ('space' == type) {
            continue;
          }
          if ('note' != value) {
            return null;
          }
          state = 1;
          break;
        case 1: //side
          if ('space' == type) {
            continue;
          }
          if ('left' != value && 'right' != value) {
            return null;
          }
          match_result.attr.side = value;
          state = 2;
          break;
        case 2: //'of'
          if ('space' == type) {
            continue;
          }
          if ('of' != value) {
            return null;
          }
          state = 3;
          break;
        case 3: //object
          if ('space' == type) {
            continue;
          }
          if ('word' != type || _is_keyword(value) || !_is_object(value)) {
            return null;
          }
          match_result.attr.object = value;
          state = 4;
          break;
        case 4: //':'
          if ('space' == in_tokens[i].type) {
            continue;
          }
          if (type != ':') {
            return null;
          }
          state = 5;
          break;
        case 5: //content
          if (type == ';' || type == 'newline' || type == 'eof') {
            state = 6;
            break;
          }
          if ('space' == type) {
            '' != match_result.attr.content && (match_result.attr.content += value);
          }
          else {
            match_result.attr.content += value;
          }
          break;
      }
    }

    if (6 != state) {
      return null;
    }

    match_result.length = i - in_offset;
    return match_result;
  }

  function _message_statement(in_tokens, in_offset) {
    var match_result = {
      type : 'message_statement',
      attr: { sender : null, receiver : null, message : '' },
      children : [],
      offset : in_offset,
      length : 0
    };

    var state = 0;
    for (var i = in_offset; i < in_tokens.length && 5 != state; ++i) {
      var type = in_tokens[i].type;
      var value = in_tokens[i].value;

      switch (state) {
        case 0: //sender
          if ('space' == type) {
            continue;
          }
          if (type != 'word' || _is_keyword(value) || !_is_object(value)) {
            return null;
          }
          match_result.attr.sender = value;
          state = 1;
          break;
        case 1: //arrow
          if ('space' == in_tokens[i].type) {
            continue;
          }
          if (type != 'arrow') {
            return null;
          }
          state = 2;
          break;
        case 2: //receiver
          if ('space' == in_tokens[i].type) {
            continue;
          }
          if (type != 'word' || _is_keyword(value) || !_is_object(value)) {
            return null;
          }
          match_result.attr.receiver = value;
          state = 3;
          break;
        case 3: //:
          if ('space' == in_tokens[i].type) {
            continue;
          }
          if (type == ';' || type == 'newline') {
            state = 5;
            break;
          }
          if (type != ':') {
            return null;
          }
          state = 4;
          break;
        case 4:
          if (type == ';' || type == 'newline' || type == 'eof') {
            state = 5;
            break;
          }

          //ignore leading spaces
          if ('space' == type) {
            '' != match_result.attr.message && (match_result.attr.message += value);
          }
          else {
            match_result.attr.message += value;
          }
          break;
        default:
          return null;
      }
    }

    if (state < 3) {
      return null;
    }

    match_result.length = i - in_offset;
    return match_result;
  }

  return {
    sequence_diagram : sequence_diagram
  };
})();
