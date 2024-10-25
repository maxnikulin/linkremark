#!/usr/bin/env python3

from argparse import ArgumentParser
from collections import OrderedDict
import json
import sys
import yaml


def make_arg_parser():
    parser = ArgumentParser(
        description="""Read JSON files passed as arguments
and combine their content.

Intended for generation of browser-specific
manifest.json for WebExtensions""",
    )
    parser.add_argument(
        '-o', '--output', default='-', metavar='OUTPUT_FILE',
        help='output file, default is stdout ("-")',
    )
    parser.add_argument(
        'input', metavar='FILE', nargs='+',
        help='input file, default is stdin ("-")',
    )
    return parser


def main():
    parser = make_arg_parser()
    args = parser.parse_args()

    result = OrderedDict()

    def update_recursive(d, patch):
        for key in list(patch.keys()):
            d_value = d.get(key)
            patch_value = patch[key]
            if isinstance(d_value, dict):
                if isinstance(patch_value, dict):
                    update_recursive(d_value, patch.pop(key))
                else:
                    raise ValueError('%r value is not an object' % (key, ))
            elif isinstance(d_value, list):
                d_value.extend(patch.pop(key))

        d.update(patch)

    def read(file_obj, result_dict):
        if file_obj.name.endswith(".yaml"):
            obj = yaml.safe_load(file_obj)
        else:
            obj = json.load(file_obj, object_pairs_hook=OrderedDict)
        update_recursive(result_dict, obj)

    def write(file_obj, result_dict):
        json.dump(
            result_dict, file_obj,
            ensure_ascii=False, indent='\t')
        print("", file=file_obj)

    for part in args.input:
        if part != '-' and part == args.output:
            raise ValueError(
                'Input and output must not be the same file: "%r"'
                % (args.input, ))

        if part == '-':
            read(sys.stdin, result)
        else:
            with open(part, 'r') as f:
                read(f, result)

    if args.output == '-':
        write(sys.stdout, result)
    else:
        with open(args.output, 'w') as f:
            write(f, result)


if __name__ == '__main__':
    main()
