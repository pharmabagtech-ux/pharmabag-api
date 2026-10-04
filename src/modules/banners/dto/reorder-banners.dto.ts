import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ReorderBannersDto {
  @ApiProperty({
    type: [String],
    description:
      'The COMPLETE ordered list of banner ids. Positions are assigned by array index. A partial list is rejected — see BannersService.reorder for why deltas are not accepted.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids!: string[];
}
