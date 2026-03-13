import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Phone is required' })
  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a valid 10-digit Indian phone number' })
  phone: string;

  @IsString()
  @IsNotEmpty({ message: 'Address is required' })
  address: string;

  @IsString()
  @IsNotEmpty({ message: 'City is required' })
  city: string;

  @IsString()
  @IsNotEmpty({ message: 'State is required' })
  state: string;

  @IsString()
  @IsNotEmpty({ message: 'Pincode is required' })
  @Length(6, 6, { message: 'Pincode must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'Pincode must be a 6-digit number' })
  pincode: string;
}
