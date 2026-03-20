const std = @import("std");

const Wyhash = std.hash.Wyhash;

export fn hash_file(path_ptr: [*]const u8, path_len: usize) callconv(.c) u64 {
    const path = path_ptr[0..path_len];
    const file = std.fs.cwd().openFile(path, .{}) catch return 0;
    defer file.close();
    const stat = file.stat() catch return 0;
    const file_size: usize = @intCast(stat.size);
    if (file_size == 0) return Wyhash.hash(0, "");
    return hashFileRead(file, file_size);
}

fn hashFileRead(file: std.fs.File, file_size: usize) u64 {
    const allocator = std.heap.page_allocator;
    const buf = allocator.alloc(u8, file_size) catch return 0;
    defer allocator.free(buf);
    const bytes_read = file.readAll(buf) catch return 0;
    return Wyhash.hash(0, buf[0..bytes_read]);
}

const Replacement = struct {
    specifier: []const u8,
    web_path: []const u8,
};

export fn rewrite_imports(
    content_ptr: [*]const u8,
    content_len: usize,
    replacements_json_ptr: [*]const u8,
    replacements_json_len: usize,
    out_ptr: [*]u8,
    out_len_ptr: *usize,
) callconv(.c) i32 {
    const content = content_ptr[0..content_len];
    const json_str = replacements_json_ptr[0..replacements_json_len];
    const allocator = std.heap.page_allocator;
    const replacements = parseReplacements(allocator, json_str) catch return -1;
    defer allocator.free(replacements);
    const max_out = out_len_ptr.*;
    var changed = false;
    var result_len: usize = 0;
    var i: usize = 0;
    while (i < content.len) {
        if (matchImportPattern(content, i)) |match_info| {
            const specifier = content[match_info.spec_start..match_info.spec_end];
            var found_replacement: ?[]const u8 = null;
            for (replacements) |r| {
                if (std.mem.eql(u8, specifier, r.specifier)) {
                    found_replacement = r.web_path;
                    break;
                }
            }
            if (found_replacement) |web_path| {
                const prefix = content[i..match_info.spec_start];
                if (result_len + prefix.len + web_path.len + 1 > max_out) return -1;
                @memcpy(out_ptr[result_len .. result_len + prefix.len], prefix);
                result_len += prefix.len;
                @memcpy(out_ptr[result_len .. result_len + web_path.len], web_path);
                result_len += web_path.len;
                i = match_info.spec_end;
                changed = true;
                continue;
            }
        }
        if (result_len >= max_out) return -1;
        out_ptr[result_len] = content[i];
        result_len += 1;
        i += 1;
    }
    out_len_ptr.* = result_len;
    return if (changed) @as(i32, 1) else @as(i32, 0);
}

const MatchInfo = struct { spec_start: usize, spec_end: usize };

fn matchImportPattern(content: []const u8, pos: usize) ?MatchInfo {
    if (matchFromPattern(content, pos)) |info| return info;
    if (matchBareImportPattern(content, pos)) |info| return info;
    if (matchDynamicImportPattern(content, pos)) |info| return info;
    return null;
}

fn matchFromPattern(content: []const u8, pos: usize) ?MatchInfo {
    if (pos + 5 >= content.len) return null;
    if (!std.mem.eql(u8, content[pos .. pos + 4], "from")) return null;
    var i = pos + 4;
    while (i < content.len and content[i] == ' ') : (i += 1) {}
    if (i >= content.len) return null;
    const quote = content[i];
    if (quote != '\'' and quote != '"') return null;
    i += 1;
    const spec_start = i;
    while (i < content.len and content[i] != quote) : (i += 1) {}
    if (i >= content.len) return null;
    return MatchInfo{ .spec_start = spec_start, .spec_end = i };
}

fn matchBareImportPattern(content: []const u8, pos: usize) ?MatchInfo {
    if (pos + 7 >= content.len) return null;
    if (!std.mem.eql(u8, content[pos .. pos + 6], "import")) return null;
    var i = pos + 6;
    while (i < content.len and content[i] == ' ') : (i += 1) {}
    if (i >= content.len) return null;
    const quote = content[i];
    if (quote != '\'' and quote != '"') return null;
    i += 1;
    const spec_start = i;
    while (i < content.len and content[i] != quote) : (i += 1) {}
    if (i >= content.len) return null;
    if (pos > 0 and isIdentChar(content[pos - 1])) return null;
    return MatchInfo{ .spec_start = spec_start, .spec_end = i };
}

fn matchDynamicImportPattern(content: []const u8, pos: usize) ?MatchInfo {
    if (pos + 8 >= content.len) return null;
    if (!std.mem.eql(u8, content[pos .. pos + 7], "import(")) return null;
    var i = pos + 7;
    while (i < content.len and content[i] == ' ') : (i += 1) {}
    if (i >= content.len) return null;
    const quote = content[i];
    if (quote != '\'' and quote != '"') return null;
    i += 1;
    const spec_start = i;
    while (i < content.len and content[i] != quote) : (i += 1) {}
    if (i >= content.len) return null;
    return MatchInfo{ .spec_start = spec_start, .spec_end = i };
}

fn isIdentChar(c: u8) bool {
    return (c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or (c >= '0' and c <= '9') or c == '_' or c == '$';
}

fn parseReplacements(allocator: std.mem.Allocator, json_str: []const u8) ![]Replacement {
    var replacements = std.ArrayListUnmanaged(Replacement){};
    errdefer replacements.deinit(allocator);
    var i: usize = 0;
    while (i < json_str.len and json_str[i] != '[') : (i += 1) {}
    if (i >= json_str.len) return error.InvalidJson;
    i += 1;
    while (i < json_str.len) {
        while (i < json_str.len and (json_str[i] == ' ' or json_str[i] == ',' or json_str[i] == '\n' or json_str[i] == '\r' or json_str[i] == '\t')) : (i += 1) {}
        if (i >= json_str.len or json_str[i] == ']') break;
        if (json_str[i] != '[') return error.InvalidJson;
        i += 1;
        const spec = try parseJsonString(json_str, &i);
        while (i < json_str.len and (json_str[i] == ' ' or json_str[i] == ',')) : (i += 1) {}
        const path = try parseJsonString(json_str, &i);
        while (i < json_str.len and json_str[i] != ']') : (i += 1) {}
        if (i < json_str.len) i += 1;
        try replacements.append(allocator, Replacement{ .specifier = spec, .web_path = path });
    }
    return try replacements.toOwnedSlice(allocator);
}

fn parseJsonString(json: []const u8, pos: *usize) ![]const u8 {
    var i = pos.*;
    while (i < json.len and json[i] != '"') : (i += 1) {}
    if (i >= json.len) return error.InvalidJson;
    i += 1;
    const start = i;
    while (i < json.len and json[i] != '"') : (i += 1) {
        if (json[i] == '\\') i += 1;
    }
    if (i >= json.len) return error.InvalidJson;
    const end = i;
    pos.* = i + 1;
    return json[start..end];
}
