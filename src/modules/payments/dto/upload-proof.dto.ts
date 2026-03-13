import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class UploadProofDto {
  @IsUrl({}, { message: 'proofUrl must be a valid URL' })
  @IsString()
  @IsNotEmpty({ message: 'proofUrl is required' })
  proofUrl: string;
}
